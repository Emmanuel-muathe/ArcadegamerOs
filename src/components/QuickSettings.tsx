import React, { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { Wifi, WifiOff, Bluetooth, BluetoothOff, Battery, ChevronLeft, ChevronRight, Settings as SettingsIcon, Loader2 } from 'lucide-react';
import { useWindowManager } from '../contexts/WindowManagerContext';

export function QuickSettings({ isOpen, onClose, position }: { isOpen: boolean, onClose: () => void, position: string }) {
  const { openWindow } = useWindowManager();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [battery, setBattery] = useState<any>(null);
  const [wifiNetworks, setWifiNetworks] = useState<any[]>([]);
  const [bluetooth, setBluetooth] = useState<any>(null);
  
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [btEnabled, setBtEnabled] = useState(true);
  const [wifiBusy, setWifiBusy] = useState(false);
  const [btBusy, setBtBusy] = useState(false);
  const [networkActionBusy, setNetworkActionBusy] = useState<string | null>(null);
  const [btActionBusy, setBtActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    
    // Fetch system states when opened
    fetch('/api/system/battery').then(r => r.json()).then(d => !d.error && setBattery(d)).catch(() => {});
    fetch('/api/system/wifi').then(r => r.json()).then(d => {
      if (!d.error) {
        setWifiNetworks(d.networks || []);
        setWifiEnabled(d.enabled !== false);
      }
    }).catch(() => {});
    fetch('/api/system/bluetooth').then(r => r.json()).then(d => {
      if (!d.error) {
        setBluetooth(d);
        setBtEnabled(!!d.enabled);
      }
    }).catch(() => {});
  }, [isOpen]);

  const toggleWifi = async () => {
    if (wifiBusy) return;
    const next = !wifiEnabled;
    setWifiBusy(true);
    try {
      const res = await fetch('/api/system/wifi/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      const data = await res.json();
      if (!data.error) {
        setWifiEnabled(next);
        if (!next) {
          setWifiNetworks([]);
        }
      }
    } catch (e) {
      console.error('Failed to toggle Wi-Fi', e);
    }
    setWifiBusy(false);
  };

  const toggleBluetooth = async () => {
    if (btBusy) return;
    const next = !btEnabled;
    setBtBusy(true);
    try {
      const res = await fetch('/api/system/bluetooth/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      const data = await res.json();
      if (!data.error) {
        setBtEnabled(next);
      }
    } catch (e) {
      console.error('Failed to toggle Bluetooth', e);
    }
    setBtBusy(false);
  };

  const connectToWifi = async (ssid: string, secured: boolean) => {
    if (networkActionBusy) return;
    setNetworkActionBusy(ssid);
    try {
      let password = '';
      if (secured) {
        password = window.prompt(`Enter password for ${ssid}`) || '';
      }
      await fetch('/api/system/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password })
      });
      const res = await fetch('/api/system/wifi');
      const data = await res.json();
      setWifiNetworks(data.networks || []);
    } catch (e) {
      console.error('Failed to connect Wi-Fi', e);
    }
    setNetworkActionBusy(null);
  };

  const disconnectWifi = async () => {
    if (networkActionBusy) return;
    setNetworkActionBusy('disconnect');
    try {
      await fetch('/api/system/wifi/disconnect', { method: 'POST' });
      const res = await fetch('/api/system/wifi');
      const data = await res.json();
      setWifiNetworks(data.networks || []);
    } catch (e) {
      console.error('Failed to disconnect Wi-Fi', e);
    }
    setNetworkActionBusy(null);
  };

  const toggleBtDevice = async (device: any) => {
    if (btActionBusy) return;
    setBtActionBusy(device.mac);
    try {
      await fetch(`/api/system/bluetooth/${device.connected ? 'disconnect' : 'connect'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: device.mac })
      });
      const res = await fetch('/api/system/bluetooth');
      const data = await res.json();
      setBluetooth(data);
    } catch (e) {
      console.error('Failed to toggle Bluetooth device', e);
    }
    setBtActionBusy(null);
  };
  if (!isOpen) return null;

  const renderCalendar = () => {
    const startDate = startOfWeek(currentDate);
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(addDays(startDate, i));
    }

    return (
      <div className="bg-gray-800/50 rounded-2xl p-4 mb-4">
        <div className="flex justify-between items-center mb-4">
          <span className="font-semibold text-lg">{format(currentDate, 'MMMM yyyy')}</span>
          <div className="flex space-x-2">
            <button onClick={() => setCurrentDate(subWeeks(currentDate, 4))} className="p-1 hover:bg-white/10 rounded-full"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={() => setCurrentDate(addWeeks(currentDate, 4))} className="p-1 hover:bg-white/10 rounded-full"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-2">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-sm">
          {days.map((day, i) => {
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = day.getMonth() === currentDate.getMonth();
            return (
              <div 
                key={i} 
                className={`p-1.5 rounded-full flex items-center justify-center ${isToday ? 'bg-blue-500 text-white font-bold' : isCurrentMonth ? 'text-gray-200 hover:bg-white/10 cursor-pointer' : 'text-gray-600'}`}
              >
                {format(day, 'd')}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getPositionClasses = () => {
    switch (position) {
      case 'Top': return 'top-16 right-4';
      case 'Left': return 'bottom-4 left-20';
      case 'Right': return 'bottom-4 right-20';
      case 'Bottom': default: return 'bottom-16 right-4';
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`fixed z-50 w-80 bg-gray-900/95 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl p-4 text-gray-100 ${getPositionClasses()} animate-in fade-in slide-in-from-bottom-4 duration-200`}>
        
        {/* Quick Toggles */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button 
            type="button"
            className={`p-4 rounded-2xl flex flex-col cursor-pointer transition-colors ${wifiEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-800 hover:bg-gray-700'}`}
            onClick={toggleWifi}
            aria-pressed={wifiEnabled}
          >
            <div className="flex justify-between items-start mb-2">
              {wifiEnabled ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5 text-gray-400" />}
            </div>
            <span className="font-medium text-sm">Wi-Fi</span>
            <span className="text-xs text-blue-200 truncate">{wifiBusy ? 'Updating...' : wifiEnabled ? (wifiNetworks[0]?.ssid || 'On') : 'Off'}</span>
          </button>

          <button 
            type="button"
            className={`p-4 rounded-2xl flex flex-col cursor-pointer transition-colors ${btEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-800 hover:bg-gray-700'}`}
            onClick={toggleBluetooth}
            aria-pressed={btEnabled}
          >
            <div className="flex justify-between items-start mb-2">
              {btEnabled ? <Bluetooth className="w-5 h-5" /> : <BluetoothOff className="w-5 h-5 text-gray-400" />}
            </div>
            <span className="font-medium text-sm">Bluetooth</span>
            <span className="text-xs text-blue-200 truncate">{btBusy ? 'Updating...' : btEnabled ? (bluetooth?.devices?.find((d:any) => d.connected)?.name || 'On') : 'Off'}</span>
          </button>
        </div>

        <div className="bg-gray-800/40 rounded-2xl p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-gray-400">Wi-Fi Networks</span>
            {wifiNetworks.some(n => n.connected) && (
              <button type="button" onClick={disconnectWifi} className="text-xs text-red-300 hover:text-red-200">
                Disconnect
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-28 overflow-y-auto custom-scrollbar pr-1">
            {wifiNetworks.slice(0, 5).map((network) => (
              <button
                key={network.ssid}
                type="button"
                onClick={() => connectToWifi(network.ssid, !!network.security && network.security !== '--')}
                className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm flex items-center justify-between"
                disabled={networkActionBusy !== null || network.connected}
              >
                <span className="truncate mr-2">{network.ssid}</span>
                <span className="text-xs text-gray-400">{network.connected ? 'Connected' : `${network.signal || 0}%`}</span>
              </button>
            ))}
            {wifiNetworks.length === 0 && <p className="text-xs text-gray-500 px-1">No networks found.</p>}
          </div>
        </div>

        <div className="bg-gray-800/40 rounded-2xl p-3 mb-4">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Bluetooth Devices</div>
          <div className="space-y-2 max-h-24 overflow-y-auto custom-scrollbar pr-1">
            {(bluetooth?.devices || []).slice(0, 4).map((device: any) => (
              <button
                key={device.mac || device.name}
                type="button"
                onClick={() => toggleBtDevice(device)}
                className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm flex items-center justify-between"
                disabled={btActionBusy !== null}
              >
                <span className="truncate mr-2">{device.name}</span>
                <span className="text-xs text-gray-400">{device.connected ? 'Disconnect' : 'Connect'}</span>
              </button>
            ))}
            {btActionBusy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            {(!bluetooth?.devices || bluetooth.devices.length === 0) && <p className="text-xs text-gray-500 px-1">No devices found.</p>}
          </div>
        </div>

        {/* Sliders (Mocked for now) */}
        <div className="bg-gray-800/50 rounded-2xl p-4 mb-4 space-y-4">
          <div className="flex items-center space-x-3">
            <Battery className="w-5 h-5 text-gray-400" />
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500" style={{ width: `${battery?.capacity || 100}%` }} />
            </div>
            <span className="text-xs text-gray-400 w-8 text-right">{battery?.capacity || 100}%</span>
          </div>
        </div>

        {/* Calendar */}
        {renderCalendar()}

        {/* Footer */}
        <div className="flex justify-between items-center px-2 pt-2 border-t border-gray-800">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{format(new Date(), 'EEEE, MMMM d')}</span>
          </div>
          <button 
            onClick={() => { onClose(); openWindow('settings', 'System Settings', 'settings'); }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <SettingsIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>
    </>
  );
}
