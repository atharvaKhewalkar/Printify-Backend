const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db'); // Import the database module

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

// NOTE: The user-facing frontend still uses these endpoints
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
app.post('/api/orders', async (req, res) => {
    // This endpoint is kept for the client-facing app
    // It creates a job in the database
    const { file, name, copies, paperSize, printSide, color } = req.body;
    if (!file || !name || !copies || !paperSize || !printSide || !color) {
        return res.status(400).json({ success: false, message: 'Missing order details.' });
    }
    try {
        const lastOrder = await db.query('SELECT order_id FROM orders ORDER BY id DESC LIMIT 1');
        let orderCounter = 1;
        if (lastOrder.rows.length > 0) {
            orderCounter = parseInt(lastOrder.rows[0].order_id.split('_')[1]) + 1;
        }
        const orderId = `ORDER_${orderCounter}`;
        const basePricePerPage = color === 'color' ? 2 : 1;
        const sizeMultiplier = paperSize === 'A3' ? 1.5 : 1;
        const sideMultiplier = printSide === 'double-sided' ? 1.8 : 1;
        const subtotal = Math.round(basePricePerPage * sizeMultiplier * sideMultiplier * copies);
        const tax = Math.round(subtotal * 0.1);
        const total = subtotal + tax;
        const queryText = `
          INSERT INTO orders(order_id, name, copies, paper_size, print_side, color, total, file_info)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const values = [orderId, name, copies, paperSize, printSide, color, total, file];
        const { rows } = await db.query(queryText, values);
        res.status(201).json({ success: true, orderId: rows[0].order_id, message: 'Order created successfully', orderDetails: rows[0] });
    } catch (err) {
        console.error('Error creating order:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
app.get('/api/status/:orderId', async (req, res) => {
    // This endpoint is kept for the client-facing app
    const { orderId } = req.params;
    try {
        const { rows } = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        if (!rows[0]) return res.status(404).json({ success: false, message: 'Order not found.' });
        res.json({ orderId: rows[0].order_id, status: rows[0].status });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


// --- NEW ENDPOINTS FOR SHOPKEEPER DASHBOARD ---

/**
 * @route   GET /api/jobs
 * @desc    Get all orders/jobs for the admin dashboard
 * @access  Protected (but no auth implemented yet)
 */
app.get('/api/jobs', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
        // The ApiService expects the data directly, so we send the array of orders.
        res.json(rows);
    } catch (err) {
        console.error('Error fetching all jobs:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route   PUT /api/jobs/:orderId/status
 * @desc    Update the status of a job
 * @access  Protected (but no auth implemented yet)
 */
app.put('/api/jobs/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'printing', 'ready', 'completed'];

    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }

    try {
        const { rows } = await db.query(
            'UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *',
            [status, orderId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        console.log(`Status for ${orderId} updated to ${status}`);
        res.json({ success: true, order: rows[0] });
    } catch (err) {
        console.error(`Error updating status for ${orderId}:`, err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/earnings
 * @desc    Get earnings data for the dashboard
 * @access  Protected (but no auth implemented yet)
 */
app.get('/api/earnings', async (req, res) => {
    try {
        // Query for today's earnings
        const todayResult = await db.query(
            "SELECT SUM(total) as total FROM orders WHERE status = 'completed' AND created_at >= CURRENT_DATE"
        );
        const todayEarnings = todayResult.rows[0].total || 0;

        // Query for the last 7 days' earnings
        const weeklyResult = await db.query(
            "SELECT SUM(total) as total FROM orders WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'"
        );
        const weeklyTotal = weeklyResult.rows[0].total || 0;

        res.json({
            today: parseFloat(todayEarnings).toFixed(2),
            weekly: parseFloat(weeklyTotal).toFixed(2)
        });
    } catch (err) {
        console.error('Error fetching earnings:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


// --- Start Server ---
const startServer = async () => {
    await db.createTables();
    app.listen(port, () => {
        console.log(`🖨️ Print Shop backend listening at http://localhost:${port}`);
        console.log(`🐘 Connected to PostgreSQL database.`);
    });
};

startServer();
