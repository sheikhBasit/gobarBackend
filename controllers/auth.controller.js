/* eslint-disable no-undef */
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const signup = async (req, res) => {
   // Add body validation

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Request body is empty' });
  }

  const { name, email, password } = req.body;
  console.log("Body data: ",req.body);
  
  // Validate all required fields exist
  if (!name || !email || !password) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      missing: [
        ...(!name ? ['name'] : []),
        ...(!email ? ['email'] : []),
        ...(!password ? ['password'] : [])
      ]
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate password strength
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if user already exists (extra protection beyond unique constraint)
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1', 
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
     
    // Store user
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, passwordHash]
    );
    
    // MISSING: Omit sensitive data from response
    const userResponse = {
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      createdAt: rows[0].created_at
    };

    // MISSING: Generate JWT token for immediate login
    const token = jwt.sign(
      { userId: userResponse.id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({ 
      user: userResponse,
      token // Include token in response
    });
  } catch (err) {
    console.error('Signup error:', err);
    
    // Handle specific PostgreSQL errors
    if (err.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // MISSING: Database connection errors
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    
    res.status(500).json({ 
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
const login = async (req, res) => {

  // Add body validation


  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Request body is empty' });
  }

  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required',
      field: !email ? 'email' : 'password'
    });
  }

  try {
    // Find user
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    
    // Explicit error for non-existent email
    if (rows.length === 0) {
      return res.status(401).json({ 
        error: 'Account not found',
        suggestion: 'Please check your email or sign up'
      });
    }
    
    const user = rows[0];
    
    // Explicit error for incorrect password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        error: 'Incorrect password',
        suggestion: 'Forgot your password? Consider resetting it'
      });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { 
        id: user.id,
        // Include additional security claims
        auth_time: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        issuer: 'gobar-api'
      }
    );
    
    // Secure response
    res.json({ 
      token,
      token_type: 'Bearer',
      expires_in: parseInt(process.env.JWT_EXPIRES_IN || '3600', 10),
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email,
        
      }
    });
    
  } catch (err) {
    console.error('Login error:', err);
    
    // Specific database errors
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    
    res.status(500).json({ 
      error: 'Login failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = { signup, login };