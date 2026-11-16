import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanError, isLate, LOAN_STATUS } from '../src/api.js';

test('messages d’erreur lisibles', () => {
  assert.match(humanError(new Error('has_overdue')), /retard/);
  assert.match(humanError(new Error('xyz')), /xyz/);
});

test('détection des retards', () => {
  assert.equal(isLate({ due_at: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(isLate({ due_at: new Date(Date.now() + 1e6).toISOString() }), false);
  assert.equal(isLate({ due_at: '2000-01-01', returned_at: '2000-01-02' }), false);
});

test('libellés des statuts d’emprunt', () => {
  assert.deepEqual(Object.keys(LOAN_STATUS), ['active', 'overdue', 'returned']);
});
