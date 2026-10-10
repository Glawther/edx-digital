---
name: nexus-crm-architecture
description: Directives, architectural patterns, and quality standards for EDX Digital development (Vanilla JS, PWA Offline-First, Firestore Sync, Gemini AI, and Ergonomics).
---

# EDX Digital Architectural Standards

## 1. Core Principles
- **Zero Heavy Frameworks**: Pure Vanilla JavaScript (ES Modules), HTML5 and CSS3.
- **PWA & Offline-First**: All data must persist locally via `LocalStorage` / `IndexedDB` with immediate UI updates, synchronizing asynchronously with Google Cloud Firestore (`onSnapshot`).
- **Tríade CID & Security**: Confidentiality, Integrity and Availability. Role-Based Access Control (Admin vs. Employee). All sensitive mutations generate audit trail logs in `audit_logs`.

## 2. Real-Time Cloud Firestore Sync
- Use `firebase-service.js` with Firebase Modular SDK.
- Always use `setDoc(docRef, data, { merge: true })` for updates and upserts to avoid 404 / 'No document to update' errors.
- Preserve bidirectional ID mapping (`id` vs `firestoreId` vs `clientLeadId`).

## 3. Gemini AI Integration Patterns
- Keep API Keys safe in user-controlled browser storage (`nexus_crm_gemini_api_key`).
- Use Gemini 1.5/2.0 Flash for speed and cost efficiency.
- Generate structured actionable insights: Win Probability (0-100%), Deal Sentiment, SWOT Analysis, Recommended Next Action, and tailored outreach drafts.

## 4. UI/UX & Ergonomics Standards
- Responsive Glassmorphism: Blur backdrops, crisp borders, tailored dark and light themes with strict color contrast compliance (WCAG AA).
- Ergonomic controls: Action buttons, search bars and filters placed comfortably for one-hand / desktop usage.
