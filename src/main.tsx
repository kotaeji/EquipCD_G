import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/fonts.css';
import './ui/styles.css';
import './ui/run3d.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
