#!/bin/bash

# Build script for Signalle
# This ensures all files are properly copied to the dist directory

# Create dist directory if it doesn't exist
mkdir -p dist

# Copy source files
cp src/*.mjs dist/

# Copy type definitions
cp src/types.d.ts dist/

# Display build results
echo "📦 Build complete!"
echo "Files in dist directory:"
ls -la dist/
