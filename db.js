const { Pool } = require('pg');

// --- Database Connection Pool ---
// The pool will manage connections to your PostgreSQL database.
// IMPORTANT: Replace the connection details with your actual PostgreSQL credentials.
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'print_shop_db',
  password: 'admin',
  port: 5432,
});

// --- Function to Create Database Schema ---
// This function will create the 'orders' table if it doesn't already exist.
const createTables = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      copies INTEGER NOT NULL,
      paper_size VARCHAR(50) NOT NULL,
      print_side VARCHAR(50) NOT NULL,
      color VARCHAR(50) NOT NULL,
      total NUMERIC(10, 2) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      payment_method VARCHAR(50),
      payment_status VARCHAR(50),
      file_info JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log('📦 "orders" table is ready.');
  } catch (err) {
    console.error('Error creating table:', err);
    // Exit the process if we can't create the table
    process.exit(1);
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  createTables,
};
