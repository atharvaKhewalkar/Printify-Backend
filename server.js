const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db'); // Import the new database module

const app = express();
const port = 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- File Upload Setup (using multer) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// --- API Endpoints ---

/**
 * @route   POST /api/upload
 * @desc    Upload a file
 * @access  Public
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }
  res.json({
    success: true,
    fileId: req.file.filename,
    fileName: req.file.originalname,
    fileUrl: `/uploads/${req.file.filename}`
  });
});

/**
 * @route   POST /api/orders
 * @desc    Create a new order
 * @access  Public
 */
app.post('/api/orders', async (req, res) => {
  const { file, name, copies, paperSize, printSide, color } = req.body;

  if (!file || !name || !copies || !paperSize || !printSide || !color) {
    return res.status(400).json({ success: false, message: 'Missing order details.' });
  }

  try {
    // Get the latest order ID to calculate the next one
    const lastOrder = await db.query('SELECT order_id FROM orders ORDER BY id DESC LIMIT 1');
    let orderCounter = 1;
    if (lastOrder.rows.length > 0) {
        orderCounter = parseInt(lastOrder.rows[0].order_id.split('_')[1]) + 1;
    }
    const orderId = `ORDER_${orderCounter}`;

    // Simplified pricing logic
    const basePricePerPage = color === 'color' ? 2 : 1;
    const sizeMultiplier = paperSize === 'A3' ? 1.5 : 1;
    const sideMultiplier = printSide === 'double-sided' ? 1.8 : 1;
    const subtotal = Math.round(basePricePerPage * sizeMultiplier * sideMultiplier * copies);
    const tax = Math.round(subtotal * 0.1); // 10% tax
    const total = subtotal + tax;

    const queryText = `
      INSERT INTO orders(order_id, name, copies, paper_size, print_side, color, total, file_info)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [orderId, name, copies, paperSize, printSide, color, total, file];
    
    const { rows } = await db.query(queryText, values);
    const newOrder = rows[0];

    console.log('New Order Created:', newOrder);

    res.status(201).json({
      success: true,
      orderId: newOrder.order_id,
      message: 'Order created successfully',
      orderDetails: newOrder
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route   GET /api/status/:orderId
 * @desc    Get order status
 * @access  Public
 */
app.get('/api/status/:orderId', async (req, res) => {
    const { orderId } = req.params;
    
    try {
        const { rows } = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        const order = rows[0];

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }
        
        // This part can be removed if you have an admin panel to update status
        const statuses = ['pending', 'processing', 'printing', 'ready', 'completed'];
        const currentStatusIndex = statuses.indexOf(order.status);
        if (currentStatusIndex < statuses.length - 1) {
            const randomChance = Math.random();
            if (randomChance > 0.8) { // 20% chance to progress
                const newStatus = statuses[currentStatusIndex + 1];
                await db.query('UPDATE orders SET status = $1 WHERE order_id = $2', [newStatus, orderId]);
                order.status = newStatus;
            }
        }

        res.json({
            orderId: order.order_id,
            status: order.status,
            estimatedCompletion: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            message: `Order is currently ${order.status}`,
        });
    } catch (err) {
        console.error('Error fetching status:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


/**
 * @route   POST /api/payment
 * @desc    Process a payment
 * @access  Public
 */
app.post('/api/payment', async (req, res) => {
    const { orderId, paymentMethod, amount } = req.body;
    
    try {
        const { rows } = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const paymentStatus = paymentMethod === 'online' ? 'success' : 'pending';
        await db.query('UPDATE orders SET payment_method = $1, payment_status = $2 WHERE order_id = $3', [paymentMethod, paymentStatus, orderId]);

        console.log(`Payment processed for ${orderId}:`, paymentStatus);
        res.json({
            success: true,
            paymentId: `PAY_${Date.now().toString(36).toUpperCase()}`,
            status: paymentStatus,
            transactionId: paymentMethod === 'online' ? `TXN_${Date.now()}` : undefined,
        });

    } catch (err) {
        console.error('Error processing payment:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


// --- Start Server ---
const startServer = async () => {
    // This function will create the 'orders' table if it doesn't exist.
    await db.createTables(); 
    app.listen(port, () => {
        console.log(`🖨️ Print Shop backend listening at http://localhost:${port}`);
        console.log(`🐘 Connected to PostgreSQL database.`);
    });
};

startServer();
