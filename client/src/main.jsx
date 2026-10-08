import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// All bundled locally - nothing is fetched from a CDN at runtime, so the app
// works with no internet connection.
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/tokens.css';
import './styles/app.css';

import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
