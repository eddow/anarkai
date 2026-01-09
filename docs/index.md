# Anarkai Monorepo Documentation

Welcome to the documentation for the **Anarkai** project.

## 📚 Documentation Overview

This documentation is generated to help developers understand the structure and architecture of the Anarkai monorepo.

- **[Project Inventory](./project-inventory.md)**: detailed list of apps, engines, and packages.
- **[Architecture Overview](./architecture-overview.md)**: High-level system design and dependencies.

## 🏗️ Project Structure

The project is organized as a monorepo using **pnpm** workspaces.

### 📱 Applications (`apps/`)
- **browser-pounce**: Web application built with Pounce-TS.
- **browser-vue**: Web application built with Vue 3.

### 🎮 Engines (`engines/`)
- **ssh**: The core Game Engine.

### 📦 Packages (`packages/`)
- **mutts**: Core reactive utility library.
- **npcs**: NPC behavior and script execution system.
- **omni18n**: Internationalization library.
- **pounce-ts**: Lightweight reactive web framework.
- **pounce-ui**: UI component library.

## 🚀 Getting Started

### Prerequisites
- Node.js
- pnpm

### Installation

```bash
pnpm install
```

### Development

Run all applications in development mode:

```bash
pnpm dev
```

Run specific app:

```bash
pnpm --filter <package-name> dev
```
