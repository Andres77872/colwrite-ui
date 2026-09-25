/**
 * Entry for `figure-gallery.html` (development only). `?only=<template id>`
 * shows a single figure.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import 'katex/dist/katex.min.css';
import '../styles/globals.css';
import { FigureGallery } from './FigureGallery';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FigureGallery />
  </StrictMode>,
);
