import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getFrontendConfig } from './lib/config';

const configResult = getFrontendConfig();
const root = createRoot(document.getElementById('root')!);

// Fail safe: missing configuration renders an actionable screen, never a
// blank page and never a crash from module-level Firebase/Supabase init.
if (!configResult.ok) {
  root.render(<ConfigErrorScreen missing={configResult.missing} />);
} else {
  root.render(
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  );
}
