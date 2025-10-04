const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

const queryRoutes = require('./routes/query');
const { errorHandler } = require('./middleware/errorHandler');
const { connectDatabase, connectRedis } = require('./config/database');
const { verifyToken } = require('./config/keycloak');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'bistun-db-gateway',
    version: '1.0.0'
  });
});

// API routes
app.use('/api/query', queryRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// WebSocket server for real-time queries
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket connection');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'authenticate') {
        // Verify token
        const decoded = await verifyToken(data.token);
        
        // Get user and project info
        const { query } = require('./config/database');
        const userResult = await query(
          'SELECT id FROM global_users WHERE keycloak_id = $1 AND is_active = true',
          [decoded.sub]
        );
        
        if (userResult.rows.length === 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
          return;
        }
        
        ws.userId = userResult.rows[0].id;
        ws.projectId = data.projectId;
        
        ws.send(JSON.stringify({ type: 'authenticated', message: 'Authentication successful' }));
      } else if (data.type === 'query' && ws.userId && ws.projectId) {
        // Handle real-time query
        const { executeQuery } = require('./services/queryService');
        const result = await executeQuery(ws.projectId, data.query, ws.userId);
        
        ws.send(JSON.stringify({ 
          type: 'query_result', 
          data: result,
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error('❌ WebSocket error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// Start server
async function startServer() {
  try {
    // Connect to databases
    await connectDatabase();
    await connectRedis();
    console.log('✅ Databases connected successfully');
    
    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Bistun DB Gateway running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

startServer();