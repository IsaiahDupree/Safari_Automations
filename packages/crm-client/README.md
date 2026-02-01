# CRM Client

Thin client for CRM operations. Prepares for migration of CRM to a separate repository.

## Purpose

This package provides a client interface for CRM operations. Currently operates in "local mode" using the embedded `crm-core` package. When CRM is migrated to its own repository and API, this client will switch to HTTP mode without requiring changes to consuming code.

## Usage

```typescript
import { CRMClient } from '@safari-automation/crm-client';

const crm = new CRMClient();

// Get a contact
const contact = await crm.getContact('contact_id');

// List contacts
const contacts = await crm.listContacts({
  platform: 'tiktok',
  tags: ['lead'],
  limit: 50,
});

// Create a contact
const newContact = await crm.createContact({
  platform: 'tiktok',
  username: 'creator123',
  displayName: 'Creator Name',
  tags: ['lead'],
});

// Log an interaction
await crm.logInteraction({
  contactId: 'contact_id',
  type: 'dm_sent',
  platform: 'tiktok',
  content: 'Hello!',
  timestamp: new Date(),
});

// Sync from platform
await crm.syncFromPlatform('tiktok');
```

## Configuration

```typescript
// Local mode (default - uses crm-core directly)
const crm = new CRMClient();

// API mode (when CRM API is available)
const crm = new CRMClient({
  apiUrl: 'http://localhost:3020',
  timeout: 30000,
});

// Switch modes
crm.setApiMode('http://localhost:3020');
crm.setLocalMode();
```

## Migration Plan

1. CRM repository created separately
2. CRM API deployed on port 3020
3. Update this client to use API mode by default
4. Remove `crm-core` from Safari Automation repo

## Types

```typescript
interface Contact {
  id: string;
  platform: 'tiktok' | 'instagram' | 'twitter';
  username: string;
  displayName?: string;
  tags: string[];
  relationshipScore?: number;
  lastInteraction?: Date;
}

interface Interaction {
  id: string;
  contactId: string;
  type: 'dm_sent' | 'dm_received' | 'comment' | 'like' | 'follow';
  platform: string;
  content?: string;
  timestamp: Date;
}
```
