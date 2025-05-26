# Backend Architecture (TypeScript)

This backend has been completely refactored into a modular TypeScript structure with strict type safety, comprehensive error handling, and structured logging.

## Directory Structure

```
src/backend/
├── server.ts              # Entry point
├── index.ts               # Alternative entry point with graceful shutdown
├── app.ts                 # Application factory
├── tsconfig.json          # TypeScript configuration
├── README.md              # This documentation
├── config/
│   └── config.ts          # Configuration settings with types
├── controllers/
│   └── socketController.ts # Socket.IO connection management
├── handlers/
│   └── downloadHandler.ts  # Socket event handlers with type safety
├── services/
│   └── downloadService.ts  # Business logic for downloads
├── utils/
│   ├── progressUtils.ts    # Utility functions for parsing
│   ├── logger.ts          # Structured logging system
│   └── errors.ts          # Custom error classes and handling
├── middleware/
│   └── setup.ts           # Express middleware setup
└── types/
    ├── index.ts           # Type exports
    ├── common.ts          # Common type definitions
    └── socket.ts          # Socket event type definitions
```

## TypeScript Features

### **Type Safety**
- **Strict TypeScript**: All files use strict type checking
- **Interface Definitions**: Comprehensive interfaces for all data structures
- **Type Guards**: Runtime type validation where needed
- **Generic Types**: Reusable type definitions

### **Enhanced Error Handling**
- **Custom Error Classes**: `AppError`, `ValidationError`, `ProcessError`, `NotFoundError`
- **Centralized Error Handling**: Consistent error responses across the application
- **Error Logging**: All errors are properly logged with context

### **Structured Logging**
- **Log Levels**: ERROR, WARN, INFO, DEBUG
- **Contextual Logging**: Rich context in all log messages
- **Timestamp Formatting**: ISO timestamps for all log entries
- **Environment-based Levels**: DEBUG in development, INFO in production

### **Type Definitions**

#### **Socket Events**
```typescript
interface DownloadRequest {
  url: string;
  args: string[];
  downloadId: string;
}

interface DownloadProgress {
  downloadId: string;
  chunk: string;
  progress?: number | null;
  eta?: string | null;
  status?: 'downloading' | 'completed' | 'error';
}
```

#### **Server Configuration**
```typescript
interface ServerConfig {
  port: number;
  cors: {
    origin: string;
    methods: string[];
  };
}
```

## Architecture Benefits

### **1. Type Safety**
- Compile-time error detection
- IntelliSense support in IDEs
- Reduced runtime errors
- Better code documentation

### **2. Maintainability**
- Clear interfaces and contracts
- Consistent error handling
- Structured logging for debugging
- Modular architecture

### **3. Developer Experience**
- Auto-completion and IntelliSense
- Refactoring support
- Clear API contracts
- Comprehensive type definitions

### **4. Production Ready**
- Structured error handling
- Comprehensive logging
- Type-safe configuration
- Graceful shutdown handling

## Development Scripts

```bash
# Development with hot reload
npm run dev:server:watch

# Development (single run)
npm run dev:server

# Type checking
npm run type-check

# Build TypeScript
npm run build:backend

# Production
npm run start:prod
```

## Logging System

The backend uses a structured logging system with different log levels:

```typescript
logger.error('Process failed', { downloadId, error: error.message });
logger.warn('Validation failed', { downloadId, reason: 'Invalid URL' });
logger.info('Download started', { downloadId, url });
logger.debug('Progress update', { downloadId, progress: 75 });
```

## Error Handling

Custom error classes provide structured error handling:

```typescript
// Validation errors (400)
throw new ValidationError('URL is required');

// Process errors (500)
throw new ProcessError('Failed to start svtplay-dl');

// Not found errors (404)
throw new NotFoundError('Download not found');
```

## Type Safety Examples

### **Socket Event Handling**
```typescript
socket.on('start-download', (data: DownloadStartData) => {
  // TypeScript ensures data has required properties
  downloadHandler.handleStartDownload(data);
});
```

### **Service Methods**
```typescript
startDownload(url: string, args: string[], downloadId: string): DownloadProcess {
  // Return type is enforced by TypeScript
  return { process, command, url };
}
```

## Configuration

The backend uses type-safe configuration:

```typescript
export const config: ServerConfig = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
};
```

## Usage

### **Development**
```bash
npm run dev:server:watch  # Hot reload
```

### **Production**
```bash
npm run start:prod        # Build and run optimized version
```

### **Type Checking**
```bash
npm run type-check        # Check types without compilation
```

The TypeScript backend provides a robust, type-safe foundation for the svtplay-dl web UI with comprehensive error handling, structured logging, and excellent developer experience!
