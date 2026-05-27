import './assets/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

document.documentElement.dataset.theme = 'dark';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
