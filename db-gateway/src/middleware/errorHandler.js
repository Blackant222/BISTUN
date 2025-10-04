const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err);

  // Default error
  let error = {
    message: err.message || 'Internal Server Error',
    status: err.status || 500
  };

  // PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        error.message = 'Resource already exists';
        error.status = 409;
        break;
      case '23503': // Foreign key violation
        error.message = 'Referenced resource does not exist';
        error.status = 400;
        break;
      case '23502': // Not null violation
        error.message = 'Required field is missing';
        error.status = 400;
        break;
      case '42P01': // Undefined table
        error.message = 'Database table not found';
        error.status = 500;
        break;
      case '42601': // Syntax error
        error.message = 'Invalid SQL syntax';
        error.status = 400;
        break;
      case '42P02': // Undefined parameter
        error.message = 'Invalid parameter';
        error.status = 400;
        break;
      case '23514': // Check violation
        error.message = 'Data validation failed';
        error.status = 400;
        break;
      default:
        error.message = 'Database error occurred';
        error.status = 500;
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    error.status = 401;
  } else if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    error.status = 401;
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    error.message = 'Validation failed';
    error.status = 400;
    error.details = err.details;
  }

  // Rate limit errors
  if (err.status === 429) {
    error.message = 'Too many requests';
    error.status = 429;
  }

  // Connection errors
  if (err.code === 'ECONNREFUSED') {
    error.message = 'Database connection failed';
    error.status = 503;
  }

  // Send error response
  res.status(error.status).json({
    error: error.message,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err.details,
      code: err.code
    })
  });
};

module.exports = { errorHandler };