import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SecureApp from './SecureApp';
import './tokens.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{import.meta.env.VITE_LIVE_API === '1' ? <SecureApp /> : <App />}</React.StrictMode>);
