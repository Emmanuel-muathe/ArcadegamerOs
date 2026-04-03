import React, { useState, useEffect } from 'react';
import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Wifi, WifiOff, Clock, Settings as SettingsIcon, Package, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { useWindowManager } from '../contexts/WindowManagerContext';
import { AppLauncher } from './AppLauncher';
import { QuickSettings } from './QuickSettings';

export function SystemTray() {
  const { openWindow } = useWindowManager();
  const [time, setTime] = useState(new Date());
  const [battery, setBattery] = useState<{ capacity: number; status: string; device: string } | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<any[]>([]);
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [batteryError, setBatteryError] = useState<string | null>(null);
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [isQuickSettingsOpen, setIsQuickSettingsOpen] = useState(false);
  const [pers, setPers] = useState<any>({ dockPosition: 'Bottom' });

  // Fetch Personalization
  useEffect(() => {
    const fetchPers = async () => {
      try {
        const res = await fetch('/api/system/personalization');
        const data = await res.json();
        setPers(data);
      } catch (e) {}
    };
    fetchPers();
    const interval = setInterval(fetchPers, 2000);
    return () => clearInterval(interval);
  }, []);

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Battery
  useEffect(() => {
    const fetchBattery = async () => {
      try {
        const res = await fetch('/api/system/battery');
        const data = await res.json();
        if (data.error) {
          setBatteryError(data.error);
        } else {
          setBattery(data);
          setBatteryError(null);
        }
      } catch (err) {
        setBatteryError('Failed to fetch battery');
      }
    };

    fetchBattery();
    const interval = setInterval(fetchBattery, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Fetch Wi-Fi
  useEffect(() => {
    const fetchWifi = async () => {
      try {
        const res = await fetch('/api/system/wifi');
        const data = await res.json();
        if (data.error) {
          setWifiError(data.error);
        } else {
          setWifiNetworks(data.networks || []);
          setWifiEnabled(data.enabled !== false);
          setWifiError(null);
        }
      } catch (err) {
        setWifiError('Failed to fetch Wi-Fi');
      }
    };

    fetchWifi();
    const interval = setInterval(fetchWifi, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const renderBatteryIcon = () => {
    if (!battery) return <Battery className="w-4 h-4 text-gray-400" />;
    if (battery.status === 'Charging') return <BatteryCharging className="w-4 h-4 text-green-400" />;
    if (battery.capacity > 90) return <BatteryFull className="w-4 h-4" />;
    if (battery.capacity > 50) return <BatteryMedium className="w-4 h-4" />;
    if (battery.capacity > 20) return <BatteryLow className="w-4 h-4 text-yellow-400" />;
    return <BatteryWarning className="w-4 h-4 text-red-500" />;
  };

  const getDockClasses = () => {
    const base = "fixed z-50 bg-gray-900/60 backdrop-blur-2xl border-white/10 flex items-center justify-between text-gray-100 transition-all shadow-[0_0_30px_rgba(0,0,0,0.3)]";
    switch (pers.dockPosition) {
      case 'Top':
        return `${base} top-0 left-0 right-0 h-14 flex-row px-4 border-b`;
      case 'Left':
        return `${base} top-0 bottom-0 left-0 w-16 flex-col py-4 px-0 border-r`;
      case 'Right':
        return `${base} top-0 bottom-0 right-0 w-16 flex-col py-4 px-0 border-l`;
      case 'Bottom':
      default:
        return `${base} bottom-0 left-0 right-0 h-14 flex-row px-4 border-t`;
    }
  };

  const isVertical = pers.dockPosition === 'Left' || pers.dockPosition === 'Right';

  return (
    <>
      <div className={getDockClasses()}>
        <div className={`flex items-center ${isVertical ? 'flex-col space-y-4' : 'flex-row space-x-2'}`}>
          <button 
            onClick={() => setIsLauncherOpen(!isLauncherOpen)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 shadow-lg ${isLauncherOpen ? 'bg-blue-500 scale-95' : 'bg-blue-600 hover:bg-blue-500 hover:scale-105'}`}
          >
            <span className="font-bold text-lg">A</span>
          </button>
        </div>

        {/* App Dock */}
        <div className={`absolute ${isVertical ? 'top-1/2 -translate-y-1/2 flex-col space-y-2' : 'left-1/2 -translate-x-1/2 flex-row space-x-2'} flex items-center`}>
          <button 
            onClick={() => openWindow('settings', 'System Settings', 'settings')}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-colors group relative"
          >
            <SettingsIcon className="w-6 h-6 text-gray-300 group-hover:text-white" />
            <span className={`absolute ${isVertical ? (pers.dockPosition === 'Left' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'right-full mr-2 top-1/2 -translate-y-1/2') : (pers.dockPosition === 'Top' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : 'bottom-full mb-2 left-1/2 -translate-x-1/2')} px-2 py-1 bg-black/80 backdrop-blur-md border border-white/10 text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap`}>Settings</span>
          </button>
          <button 
            onClick={() => openWindow('appstore', 'App Store', 'appstore')}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-colors group relative"
          >
            <Package className="w-6 h-6 text-gray-300 group-hover:text-white" />
            <span className={`absolute ${isVertical ? (pers.dockPosition === 'Left' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'right-full mr-2 top-1/2 -translate-y-1/2') : (pers.dockPosition === 'Top' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : 'bottom-full mb-2 left-1/2 -translate-x-1/2')} px-2 py-1 bg-black/80 backdrop-blur-md border border-white/10 text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap`}>App Store</span>
          </button>
          <button 
            onClick={() => openWindow('monitor', 'System Monitor', 'monitor')}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-colors group relative"
          >
            <Activity className="w-6 h-6 text-gray-300 group-hover:text-white" />
            <span className={`absolute ${isVertical ? (pers.dockPosition === 'Left' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'right-full mr-2 top-1/2 -translate-y-1/2') : (pers.dockPosition === 'Top' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : 'bottom-full mb-2 left-1/2 -translate-x-1/2')} px-2 py-1 bg-black/80 backdrop-blur-md border border-white/10 text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap`}>System Monitor</span>
          </button>
        </div>

        <div className={`flex items-center ${isVertical ? 'flex-col space-y-2' : 'flex-row space-x-2'}`}>
          {/* Unified Quick Settings Button */}
          <button 
            onClick={() => setIsQuickSettingsOpen(!isQuickSettingsOpen)}
            className={`flex items-center justify-center hover:bg-white/10 p-2 rounded-xl transition-colors cursor-pointer ${isQuickSettingsOpen ? 'bg-white/10' : ''} ${isVertical ? 'flex-col space-y-2' : 'space-x-3'}`}
          >
            <div className={`flex items-center ${isVertical ? 'flex-col space-y-2' : 'space-x-2'}`}>
              {wifiError || !wifiEnabled ? <WifiOff className="w-4 h-4 text-gray-500" /> : <Wifi className="w-4 h-4" />}
              {renderBatteryIcon()}
            </div>
            <div className={`flex flex-col ${isVertical ? 'items-center' : 'items-end'}`}>
              <span className={`text-sm font-medium leading-none ${isVertical ? 'text-xs text-center mt-1' : ''}`}>{format(time, 'HH:mm')}</span>
              {!isVertical && <span className="text-[10px] text-gray-400 leading-none mt-1">{format(time, 'MM/dd/yyyy')}</span>}
            </div>
          </button>
        </div>
      </div>
      
      <AppLauncher isOpen={isLauncherOpen} onClose={() => setIsLauncherOpen(false)} />
      <QuickSettings isOpen={isQuickSettingsOpen} onClose={() => setIsQuickSettingsOpen(false)} position={pers.dockPosition} />
    </>
  );
}
