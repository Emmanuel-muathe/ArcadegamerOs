import { useState, useEffect, type MouseEvent } from 'react';
import { SystemTray } from './components/SystemTray';
import { WindowManagerProvider, useWindowManager } from './contexts/WindowManagerContext';
import { Window } from './components/Window';
import { Settings } from './components/apps/Settings';
import { AppStore } from './components/apps/AppStore';
import { ArcadeBrowser } from './components/apps/ArcadeBrowser';
import { SystemMonitor } from './components/apps/SystemMonitor';
import { Terminal } from './components/apps/Terminal';
import { WelcomeScreen } from './components/WelcomeScreen';
import { getAppIcon } from './utils/icons';
import { X } from 'lucide-react';
import { playSound } from './utils/sounds';

function ExternalAppWindow({ payload }: { payload: string }) {
  const [status, setStatus] = useState<'launching' | 'launched' | 'failed'>('launching');
  const [message, setMessage] = useState('Launching app...');
  const [parsed, setParsed] = useState<{ name: string; exec: string } | null>(null);

  const runLaunch = async (target: { name: string; exec: string }) => {
    setStatus('launching');
    setMessage(`Running: ${target.exec}`);
    try {
      const res = await fetch('/api/system/apps/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exec: target.exec })
      });
      const data = await res.json();
      if (data.error) {
        setStatus('failed');
        setMessage(data.error);
        return;
      }
      setStatus('launched');
      setMessage(`Launched successfully: ${data.launched || target.exec}`);
    } catch (e: any) {
      setStatus('failed');
      setMessage(e.message || 'Failed to launch app');
    }
  };

  useEffect(() => {
    const launch = async () => {
      try {
        const decoded = JSON.parse(atob(payload));
        setParsed(decoded);
        await runLaunch(decoded);
      } catch (e: any) {
        setStatus('failed');
        setMessage(e.message || 'Failed to launch app');
      }
    };

    launch();
  }, [payload]);

  return (
    <div className="h-full p-6 text-gray-200 bg-gray-950">
      <h2 className="text-xl font-semibold mb-4">External App Launcher</h2>
      <p className="text-sm text-gray-400 mb-2">Status: <span className={status === 'failed' ? 'text-red-400' : 'text-green-400'}>{status}</span></p>
      <pre className="bg-black/40 border border-gray-800 rounded-lg p-3 text-sm whitespace-pre-wrap break-all">{message}</pre>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => parsed && runLaunch(parsed)}
          disabled={!parsed || status === 'launching'}
          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(message)}
          className="px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600"
        >
          Copy log
        </button>
      </div>
    </div>
  );
}

function Desktop() {
  const { windows, openWindow } = useWindowManager();
  const [pers, setPers] = useState<any>({
    wallpaper: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
    font: 'Inter',
    theme: 'dark',
    desktopApps: []
  });

  useEffect(() => {
    const fetchPers = async () => {
      try {
        const res = await fetch('/api/system/personalization');
        const data = await res.json();
        setPers(data);
      } catch (e) {}
    };
    fetchPers();
    const interval = setInterval(fetchPers, 2000); // Poll for changes
    return () => clearInterval(interval);
  }, []);

  const launchApp = async (app: any) => {
    playSound('click');
    if (app.exec.startsWith('internal:')) {
      const component = app.exec.split(':')[1];
      openWindow(component, app.name, component);
      return;
    }

    const payload = btoa(JSON.stringify({ name: app.name, exec: app.exec }));
    openWindow(`external:${app.name}`, app.name, `external:${payload}`);
  };

  const removeFromDesktop = async (e: MouseEvent, appToRemove: any) => {
    e.stopPropagation();
    try {
      const newDesktopApps = pers.desktopApps.filter((app: any) => app.name !== appToRemove.name);
      await fetch('/api/system/personalization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desktopApps: newDesktopApps })
      });
      setPers({ ...pers, desktopApps: newDesktopApps });
    } catch (e) {
      console.error(e);
    }
  };

  const renderComponent = (componentName: string) => {
    if (componentName.startsWith('external:')) {
      return <ExternalAppWindow payload={componentName.replace('external:', '')} />;
    }

    switch (componentName) {
      case 'settings': return <Settings />;
      case 'appstore': return <AppStore />;
      case 'browser': return <ArcadeBrowser />;
      case 'monitor': return <SystemMonitor />;
      case 'terminal': return <Terminal />;
      default: return <div className="p-4 text-white">Unknown App</div>;
    }
  };

  const desktopAreaClasses = () => {
    const base = 'relative z-10 w-full h-[calc(100vh-3.5rem)] md:h-screen p-4 overflow-hidden pointer-events-none';
    switch (pers.dockPosition) {
      case 'Left':
        return `${base} md:w-[calc(100vw-4rem)] md:ml-16`;
      case 'Right':
        return `${base} md:w-[calc(100vw-4rem)] md:mr-16`;
      case 'Top':
        return `${base} pt-16 md:h-[calc(100vh-3.5rem)]`;
      case 'Bottom':
      default:
        return base;
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-900 font-sans" style={{ fontFamily: pers.font }}>
      {/* Desktop Background */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500"
        style={{ backgroundImage: `url("${pers.wallpaper}")` }}
      >
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* Desktop Icons */}
      <div className="absolute inset-0 z-0 p-4 flex flex-col flex-wrap gap-4 content-start">
        {pers.desktopApps?.map((app: any, i: number) => (
          <div 
            key={i}
            className="group relative flex flex-col items-center justify-center w-24 h-24 rounded-xl hover:bg-white/10 cursor-pointer transition-colors"
            onDoubleClick={() => launchApp(app)}
          >
            <div className="w-12 h-12 flex items-center justify-center bg-black/20 rounded-xl shadow-sm mb-2">
              {getAppIcon(app)}
            </div>
            <span className="text-white text-xs text-center drop-shadow-md px-1 line-clamp-2 leading-tight">
              {app.name}
            </span>
            <button
              onClick={(e) => removeFromDesktop(e, app)}
              className="absolute top-0 right-0 p-1 bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all shadow-md"
              title="Remove from Desktop"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Desktop Area (Where windows go) - Responsive padding for bottom/side dock */}
      <div className={desktopAreaClasses()}>
        {windows.map(win => (
          <Window key={win.id} win={win}>
            {renderComponent(win.component)}
          </Window>
        ))}
      </div>

      {/* System Tray */}
      <SystemTray />
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);

  return (
    <>
      {booting && <WelcomeScreen onComplete={() => setBooting(false)} />}
      {!booting && (
        <WindowManagerProvider>
          <Desktop />
        </WindowManagerProvider>
      )}
    </>
  );
}
