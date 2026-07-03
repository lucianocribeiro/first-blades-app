import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/dashboard',
  useSelectedLayoutSegment: () => 'dashboard',
  redirect: vi.fn(),
}));

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [k: string]: unknown }) =>
    React.createElement('img', { src, alt, ...props }),
}));

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

// jsdom no implementa HTMLDialogElement.showModal()/close() (usado por
// components/ui/Modal.tsx). Polyfill mínimo para que los tests de render
// que abren un <dialog> no fallen con "showModal is not a function".
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
