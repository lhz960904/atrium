/**
 * Renderer entry. React Scan (dev-only) instruments React by patching the
 * DevTools hook, and that must happen before react-dom's reconciler initializes
 * — which it does the moment the app module (with its react-dom import) is
 * evaluated. So the app can't be imported statically here: we start React Scan
 * first, then dynamically import and mount the app. The dev branch is
 * tree-shaken from the production bundle.
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV) {
    const { scan } = await import('react-scan');
    scan();
  }
  const { mount } = await import('./app');
  mount();
}

void bootstrap();
