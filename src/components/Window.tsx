import React from 'react';
import { motion } from 'motion/react';
import { useWindowManager, WindowState } from '../contexts/WindowManagerContext';
import { X, Square } from 'lucide-react';

type WindowProps = {
  win: WindowState;
  children: React.ReactNode;
};

export const Window: React.FC<WindowProps> = ({ win, children }) => {
  const { closeWindow, focusWindow, updateWindow } = useWindowManager();

  return (
    <motion.div
      drag={!win.maximized}
      dragMomentum={false}
      dragHandle=".window-handle"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        x: win.maximized ? 0 : win.x,
        y: win.maximized ? 0 : win.y,
        width: win.maximized ? '100vw' : win.width,
        height: win.maximized ? 'calc(100vh - 3rem)' : win.height,
      }}
      onDragEnd={(e, info) => {
        if (!win.maximized) {
          updateWindow(win.id, { x: win.x + info.offset.x, y: win.y + info.offset.y });
        }
      }}
      onPointerDown={() => focusWindow(win.id)}
      style={{ zIndex: win.zIndex }}
      className="absolute bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
    >
      <div className="window-handle h-10 bg-gray-800 flex items-center justify-between px-4 cursor-grab active:cursor-grabbing select-none border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-200">{win.title}</span>
        <div className="flex items-center space-x-3">
          <button 
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => updateWindow(win.id, { maximized: !win.maximized })} 
            className="text-gray-400 hover:text-white transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
          <button 
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => closeWindow(win.id)} 
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto relative bg-gray-950 text-gray-100">
        {children}
      </div>
    </motion.div>
  );
};
