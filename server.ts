import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { constants as fsConstants } from "fs";

const execAsync = promisify(exec);

const safePackageName = (value: string) => /^[a-zA-Z0-9@._+:-]+$/.test(value);
const safeCommandName = (value: string) => /^[/a-zA-Z0-9._+-]+$/.test(value);

const commandExists = async (command: string) => {
  if (!safeCommandName(command)) return false;
  if (command.includes('/')) {
    try {
      await fs.promises.access(command, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(':').filter(Boolean)) {
    const fullPath = path.join(dir, command);
    try {
      await fs.promises.access(fullPath, fsConstants.X_OK);
      return true;
    } catch {
      // Continue searching PATH.
    }
  }
  return false;
};

const getWifiDevice = async () => {
  const { stdout } = await execAsync("nmcli -t -f DEVICE,TYPE,STATE dev");
  const wifiLine = stdout.split('\n').find(line => {
    const [_, type] = line.split(':');
    return type === 'wifi';
  });
  return wifiLine ? wifiLine.split(':')[0] : null;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- BATTERY ---
  app.get("/api/system/battery", async (req, res) => {
    try {
      const powerSupplyDir = "/sys/class/power_supply/";
      if (!fs.existsSync(powerSupplyDir)) return res.status(404).json({ error: "No battery found" });
      const supplies = fs.readdirSync(powerSupplyDir);
      const batDir = supplies.find(dir => dir.startsWith("BAT"));
      if (!batDir) return res.status(404).json({ error: "No battery found" });

      const capacity = fs.readFileSync(path.join(powerSupplyDir, batDir, "capacity"), "utf-8").trim();
      const status = fs.readFileSync(path.join(powerSupplyDir, batDir, "status"), "utf-8").trim();
      res.json({ capacity: parseInt(capacity, 10), status, device: batDir });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- WI-FI ---
  app.get("/api/system/wifi", async (req, res) => {
    try {
      let enabled = true;
      try {
        const radio = await execAsync("nmcli radio wifi");
        enabled = radio.stdout.trim().toLowerCase() === "enabled";
      } catch (e) {
        // Keep enabled=true if status command is unavailable
      }

      if (!enabled) {
        return res.json({ enabled: false, networks: [] });
      }

      const { stdout } = await execAsync("nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY dev wifi");
      const networks = stdout.split("\n").filter(l => l.trim() !== "").map(line => {
        const [active, ssid, signal, security] = line.split(":");
        return { ssid, signal: parseInt(signal, 10), security, connected: active === 'yes' };
      }).filter(n => n.ssid && n.ssid !== "--").reduce((acc, curr) => acc.find((i: any) => i.ssid === curr.ssid) ? acc : [...acc, curr], [] as any[]);
      res.json({ enabled: true, networks });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/system/wifi/toggle", async (req, res) => {
    try {
      const enabled = !!req.body?.enabled;
      await execAsync(`nmcli radio wifi ${enabled ? 'on' : 'off'}`);
      res.json({ success: true, enabled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/system/wifi/connect", async (req, res) => {
    try {
      const { ssid, password } = req.body;
      const cmd = password ? `nmcli dev wifi connect "${ssid}" password "${password}"` : `nmcli dev wifi connect "${ssid}"`;
      const { stdout } = await execAsync(cmd);
      res.json({ success: true, output: stdout });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/system/wifi/disconnect", async (req, res) => {
    try {
      const device = await getWifiDevice();
      if (!device) {
        return res.status(404).json({ error: 'No Wi-Fi device found' });
      }
      await execAsync(`nmcli device disconnect ${device}`);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- AUDIO (Pipewire/Wireplumber) ---
  app.get("/api/system/audio", async (req, res) => {
    try {
      const { stdout } = await execAsync("wpctl get-volume @DEFAULT_AUDIO_SINK@");
      const match = stdout.match(/Volume:\s+([\d.]+)/);
      const isMuted = stdout.includes("[MUTED]");
      if (!match) throw new Error("Could not parse volume");
      res.json({ volume: Math.round(parseFloat(match[1]) * 100), muted: isMuted });
    } catch (error: any) { 
      res.json({ error: "Audio service unavailable (wpctl failed or not found)" }); 
    }
  });

  app.post("/api/system/audio", async (req, res) => {
    try {
      const { volume } = req.body;
      await execAsync(`wpctl set-volume @DEFAULT_AUDIO_SINK@ ${volume / 100}`);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- SYSTEM INFO ---
  app.get("/api/system/info", async (req, res) => {
    try {
      const cpuinfo = fs.existsSync("/proc/cpuinfo") ? fs.readFileSync("/proc/cpuinfo", "utf-8") : "";
      const meminfo = fs.existsSync("/proc/meminfo") ? fs.readFileSync("/proc/meminfo", "utf-8") : "";
      
      const cpuMatch = cpuinfo.match(/model name\s+:\s+(.+)/);
      const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      const memFreeMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);

      res.json({
        cpu: cpuMatch ? cpuMatch[1] : "Unknown CPU",
        memTotal: memTotalMatch ? Math.round(parseInt(memTotalMatch[1]) / 1024) : 0,
        memFree: memFreeMatch ? Math.round(parseInt(memFreeMatch[1]) / 1024) : 0,
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- BOOT TIME & USER INFO ---
  app.get("/api/system/boot", async (req, res) => {
    try {
      try {
        const { stdout } = await execAsync("systemd-analyze time");
        res.json({ bootTime: stdout.trim() });
        return;
      } catch (e) {
        if (fs.existsSync("/proc/uptime")) {
          const uptime = fs.readFileSync("/proc/uptime", "utf-8");
          const seconds = parseFloat(uptime.split(" ")[0]);
          res.json({ bootTime: `System up for ${seconds.toFixed(2)} seconds` });
          return;
        }
        res.json({ bootTime: "Boot time unavailable" });
      }
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- AUTHENTICATION ---
  const AUTH_FILE = path.join(process.cwd(), '.os_shadow.json');

  app.get("/api/system/auth/status", (req, res) => {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
        res.json({ isSetup: true, username: data.username });
      } else {
        res.json({ isSetup: false });
      }
    } catch (e) {
      res.json({ isSetup: false });
    }
  });

  app.post("/api/system/auth/setup", (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Missing fields" });
      
      // In a real OS, this would use PAM or shadow passwords. 
      // For this React DE preview, we store a simple base64 hash in a hidden file.
      const data = { username, password: Buffer.from(password).toString('base64') };
      fs.writeFileSync(AUTH_FILE, JSON.stringify(data));
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/system/auth/login", (req, res) => {
    try {
      const { password } = req.body;
      if (!fs.existsSync(AUTH_FILE)) return res.status(400).json({ error: "No user setup" });
      
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
      const inputHash = Buffer.from(password).toString('base64');
      
      if (data.password === inputHash) {
        res.json({ success: true });
      } else {
        res.status(401).json({ error: "Incorrect password" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- SETTINGS: ABOUT ---
  app.get("/api/system/about", async (req, res) => {
    try {
      const kernel = (await execAsync("uname -r")).stdout.trim();
      const arch = (await execAsync("uname -m")).stdout.trim();
      let uptime = "";
      try {
        uptime = (await execAsync("uptime -p")).stdout.trim();
      } catch (e) {
        if (fs.existsSync("/proc/uptime")) {
          const uptimeSeconds = parseFloat(fs.readFileSync("/proc/uptime", "utf-8").split(" ")[0]);
          const hours = Math.floor(uptimeSeconds / 3600);
          const minutes = Math.floor((uptimeSeconds % 3600) / 60);
          uptime = `up ${hours} hours, ${minutes} minutes`;
        } else {
          uptime = "Unknown";
        }
      }
      
      const cpuinfo = fs.existsSync("/proc/cpuinfo") ? fs.readFileSync("/proc/cpuinfo", "utf-8") : "";
      const meminfo = fs.existsSync("/proc/meminfo") ? fs.readFileSync("/proc/meminfo", "utf-8") : "";
      const cpuMatch = cpuinfo.match(/model name\s+:\s+(.+)/);
      const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);

      res.json({ 
        kernel, 
        arch, 
        uptime, 
        os: "Arcadegamer254 os", 
        version: "1.0.0-stable",
        cpu: cpuMatch ? cpuMatch[1].trim() : "Unknown CPU",
        ram: memTotalMatch ? Math.round(parseInt(memTotalMatch[1]) / 1024) + " MB" : "Unknown RAM"
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- SETTINGS: STORAGE ---
  app.get("/api/system/storage", async (req, res) => {
    try {
      const { stdout } = await execAsync("df -h /");
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        res.json({
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usePercentage: parts[4]
        });
      } else {
        throw new Error("Unexpected df output");
      }
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // --- SETTINGS: DISPLAY ---
  app.get("/api/system/display", async (req, res) => {
    try {
      const { stdout } = await execAsync("xrandr");
      const lines = stdout.split('\n');
      let currentRes = "";
      let currentRate = "";
      
      for (const line of lines) {
        if (line.includes('*')) {
          const match = line.trim().match(/^(\d+x\d+)\s+([\d.]+)\*/);
          if (match) {
            currentRes = match[1];
            currentRate = match[2];
          } else {
            const parts = line.trim().split(/\s+/);
            currentRes = parts[0];
            const rateMatch = parts.find(p => p.includes('*'));
            if (rateMatch) currentRate = rateMatch.replace(/[^0-9.]/g, '');
          }
        }
      }
      if (!currentRes) throw new Error("Could not parse xrandr output");
      res.json({ resolution: currentRes, refreshRate: currentRate ? currentRate + " Hz" : "" });
    } catch (e: any) {
      res.json({ error: "Display info unavailable (xrandr failed or not found)" });
    }
  });

  // --- SETTINGS: BLUETOOTH ---
  app.get("/api/system/bluetooth", async (req, res) => {
    try {
      const { stdout: showOut } = await execAsync("bluetoothctl show");
      const enabled = /Powered:\s+yes/i.test(showOut);
      if (!enabled) {
        return res.json({ enabled: false, devices: [] });
      }

      const { stdout } = await execAsync("bluetoothctl devices");
      const basicDevices = stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split(' ');
        return { mac: parts[1], name: parts.slice(2).join(' ') };
      });

      const devices = await Promise.all(basicDevices.map(async (device) => {
        try {
          const { stdout: infoOut } = await execAsync(`bluetoothctl info ${device.mac}`);
          return {
            ...device,
            paired: /Paired:\s+yes/i.test(infoOut),
            trusted: /Trusted:\s+yes/i.test(infoOut),
            connected: /Connected:\s+yes/i.test(infoOut),
          };
        } catch {
          return { ...device, paired: false, trusted: false, connected: false };
        }
      }));
      res.json({ enabled: true, devices });
    } catch (e: any) {
      res.json({ enabled: false, devices: [], error: "Bluetooth service unavailable or bluetoothctl failed" });
    }
  });

  app.post("/api/system/bluetooth/toggle", async (req, res) => {
    try {
      const enabled = !!req.body?.enabled;
      await execAsync(`bluetoothctl power ${enabled ? 'on' : 'off'}`);
      res.json({ success: true, enabled });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/system/bluetooth/connect", async (req, res) => {
    try {
      const mac = req.body?.mac;
      if (!mac || !/^[0-9A-Fa-f:]{17}$/.test(mac)) {
        return res.status(400).json({ error: 'Invalid Bluetooth MAC address' });
      }
      await execAsync(`bluetoothctl connect ${mac}`);
      res.json({ success: true, mac });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/system/bluetooth/disconnect", async (req, res) => {
    try {
      const mac = req.body?.mac;
      if (!mac || !/^[0-9A-Fa-f:]{17}$/.test(mac)) {
        return res.status(400).json({ error: 'Invalid Bluetooth MAC address' });
      }
      await execAsync(`bluetoothctl disconnect ${mac}`);
      res.json({ success: true, mac });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  // --- SETTINGS: POWER ---
  app.get("/api/system/power", async (req, res) => {
    try {
      const powerSupplyDir = "/sys/class/power_supply/";
      if (!fs.existsSync(powerSupplyDir)) throw new Error("No power supply directory");
      const supplies = fs.readdirSync(powerSupplyDir);
      const batDir = supplies.find(dir => dir.startsWith("BAT"));
      if (!batDir) throw new Error("No battery found");

      const capacity = fs.readFileSync(path.join(powerSupplyDir, batDir, "capacity"), "utf-8").trim();
      const status = fs.readFileSync(path.join(powerSupplyDir, batDir, "status"), "utf-8").trim();
      let health = "Unknown";
      try { health = fs.readFileSync(path.join(powerSupplyDir, batDir, "health"), "utf-8").trim(); } catch(e) {}
      
      res.json({ capacity, status, health });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // --- SETTINGS: DATETIME ---
  app.get("/api/system/datetime", async (req, res) => {
    try {
      const { stdout } = await execAsync("timedatectl");
      res.json({ raw: stdout.trim() });
    } catch (e: any) {
      const date = new Date().toString();
      res.json({ raw: `Local time: ${date}\nUniversal time: ${new Date().toUTCString()}`, error: "timedatectl failed" });
    }
  });

  // --- SETTINGS: REGION ---
  app.get("/api/system/region", async (req, res) => {
    try {
      const { stdout } = await execAsync("localectl");
      res.json({ raw: stdout.trim() });
    } catch (e: any) {
      res.json({ raw: "System Locale: LANG=en_US.UTF-8\nVC Keymap: us\nX11 Layout: us", error: "localectl failed" });
    }
  });

  // --- SETTINGS: DEFAULT APPS ---
  app.get("/api/system/defaultapps", async (req, res) => {
    try {
      const browser = (await execAsync("xdg-settings get default-web-browser")).stdout.trim();
      let urlScheme = "";
      try {
        urlScheme = (await execAsync("xdg-mime query default x-scheme-handler/http")).stdout.trim();
      } catch (e) {}
      res.json({ browser, urlScheme });
    } catch (e: any) {
      res.json({ error: "xdg-utils not available or failed" });
    }
  });

  // --- SETTINGS: STARTUP APPS ---
  app.get("/api/system/startup", async (req, res) => {
    try {
      const autostartDir = path.join(os.homedir(), ".config", "autostart");
      let apps: string[] = [];
      if (fs.existsSync(autostartDir)) {
        const files = fs.readdirSync(autostartDir).filter(f => f.endsWith('.desktop'));
        apps = files.map(f => f.replace('.desktop', ''));
      }
      res.json({ apps });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // --- SETTINGS: PERMISSIONS ---
  app.get("/api/system/permissions", async (req, res) => {
    try {
      const { stdout } = await execAsync("flatpak list --app --columns=application");
      const apps = stdout.trim().split('\n').filter(Boolean);
      res.json({ apps, note: "Granular permissions apply to Flatpak apps." });
    } catch (e: any) {
      res.json({ error: "Flatpak not installed or no flatpak apps found. Native Arch packages have full system access." });
    }
  });

  // --- SETTINGS: LOCKSCREEN ---
  app.get("/api/system/lockscreen", async (req, res) => {
    res.json({ status: "Managed by display manager (e.g., GDM, SDDM) or swayidle." });
  });

  // --- SETTINGS: PERSONALIZATION ---
  const settingsFile = path.join(os.homedir(), ".config", "arcadegamer254_settings.json");
  let personalization = {
    theme: 'dark',
    wallpaper: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
    font: 'Inter',
    fontSize: 14,
    dockPosition: 'Bottom',
    dockAutoHide: false,
    desktopApps: [
      { name: "Terminal", exec: "internal:terminal", icon: "terminal", category: "System" },
      { name: "App Store", exec: "internal:appstore", icon: "store", category: "System" },
      { name: "Arcade Browser", exec: "internal:browser", icon: "browser", category: "Internet" }
    ],
    systemSound: true
  };

  try {
    if (fs.existsSync(settingsFile)) {
      personalization = { ...personalization, ...JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) };
    } else {
      if (!fs.existsSync(path.dirname(settingsFile))) {
        fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      }
      fs.writeFileSync(settingsFile, JSON.stringify(personalization, null, 2));
    }
  } catch (e) {}

  app.get("/api/system/personalization", (req, res) => res.json(personalization));
  app.post("/api/system/personalization", (req, res) => {
    personalization = { ...personalization, ...req.body };
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(personalization, null, 2));
    } catch (e) {}
    res.json({ success: true, settings: personalization });
  });

  app.get("/api/system/user", (req, res) => {
    try {
      const username = require('os').userInfo().username;
      res.json({ username });
    } catch (error: any) {
      res.json({ username: "arcadegamer254" });
    }
  });

  // --- APP LAUNCHER ---
  app.get("/api/system/apps", async (req, res) => {
    try {
      const dirs = [
        "/usr/share/applications",
        path.join(process.env.HOME || "/root", ".local/share/applications")
      ];
      const apps: any[] = [];
      
      const builtInApps = [
        { name: "Terminal", exec: "internal:terminal", icon: "terminal", category: "System" },
        { name: "Settings", exec: "internal:settings", icon: "settings", category: "System" },
        { name: "App Store", exec: "internal:appstore", icon: "store", category: "System" },
        { name: "System Monitor", exec: "internal:monitor", icon: "activity", category: "System" },
        { name: "Arcade Browser", exec: "internal:browser", icon: "browser", category: "Internet" },
        // Games
        { name: "Minecraft", exec: "minecraft-launcher", icon: "game", category: "Games" },
        { name: "Steam", exec: "steam", icon: "game", category: "Games" },
        { name: "Lutris", exec: "lutris", icon: "game", category: "Games" },
        { name: "RetroArch", exec: "retroarch", icon: "game", category: "Games" },
        { name: "CS:GO", exec: "steam -applaunch 730", icon: "game", category: "Games" },
        { name: "Dota 2", exec: "steam -applaunch 570", icon: "game", category: "Games" },
        { name: "SuperTuxKart", exec: "supertuxkart", icon: "game", category: "Games" },
        { name: "0 A.D.", exec: "0ad", icon: "game", category: "Games" },
        { name: "Xonotic", exec: "xonotic", icon: "game", category: "Games" },
        { name: "Minetest", exec: "minetest", icon: "game", category: "Games" },
        // Apps
        { name: "Firefox", exec: "firefox", icon: "browser", category: "Internet" },
        { name: "Google Chrome", exec: "google-chrome-stable", icon: "browser", category: "Internet" },
        { name: "VLC Media Player", exec: "vlc", icon: "video", category: "Media" },
        { name: "OBS Studio", exec: "obs", icon: "video", category: "Media" },
        { name: "Discord", exec: "discord", icon: "chat", category: "Internet" },
        { name: "GIMP", exec: "gimp", icon: "image", category: "Graphics" },
        { name: "Krita", exec: "krita", icon: "image", category: "Graphics" },
        { name: "Blender", exec: "blender", icon: "image", category: "Graphics" },
        { name: "VS Code", exec: "code", icon: "code", category: "Development" },
        { name: "LibreOffice", exec: "libreoffice", icon: "office", category: "Office" },
        { name: "Spotify", exec: "spotify", icon: "music", category: "Media" },
        { name: "Thunderbird", exec: "thunderbird", icon: "mail", category: "Internet" },
        { name: "Transmission", exec: "transmission-gtk", icon: "download", category: "Internet" },
        { name: "FileZilla", exec: "filezilla", icon: "download", category: "Internet" },
        { name: "Audacity", exec: "audacity", icon: "music", category: "Media" },
        { name: "Kdenlive", exec: "kdenlive", icon: "video", category: "Media" },
        { name: "Inkscape", exec: "inkscape", icon: "image", category: "Graphics" },
        { name: "HandBrake", exec: "ghb", icon: "video", category: "Media" },
        { name: "VirtualBox", exec: "virtualbox", icon: "system", category: "System" },
        { name: "Docker", exec: "docker-desktop", icon: "system", category: "Development" }
      ];

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".desktop"));
        
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(dir, file), "utf-8");
            const nameMatch = content.match(/^Name=(.+)$/m);
            const execMatch = content.match(/^Exec=(.+)$/m);
            const iconMatch = content.match(/^Icon=(.+)$/m);
            const categoryMatch = content.match(/^Categories=(.+)$/m);
            
            let category = "Other";
            if (categoryMatch) {
              const cats = categoryMatch[1].split(';');
              if (cats.includes('Game')) category = "Games";
              else if (cats.includes('Network') || cats.includes('WebBrowser')) category = "Internet";
              else if (cats.includes('AudioVideo')) category = "Media";
              else if (cats.includes('Graphics')) category = "Graphics";
              else if (cats.includes('Development')) category = "Development";
              else if (cats.includes('Office')) category = "Office";
              else if (cats.includes('System') || cats.includes('Settings')) category = "System";
              else if (cats.includes('Utility')) category = "Utilities";
            }

            if (nameMatch && execMatch) {
              apps.push({
                name: nameMatch[1].trim(),
                exec: execMatch[1].trim().replace(/%[a-zA-Z]/g, "").trim(),
                icon: iconMatch ? iconMatch[1].trim() : "",
                category
              });
            }
          } catch (e) { /* ignore unreadable files */ }
        }
      }
      
      // Deduplicate by name and sort
      const uniqueApps = Array.from(new Map([...builtInApps, ...apps].map(a => [a.name, a])).values());
      uniqueApps.sort((a, b) => a.name.localeCompare(b.name));
      
      res.json({ apps: uniqueApps });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/system/apps/launch", async (req, res) => {
    try {
      const { exec: cmd } = req.body;
      if (!cmd || typeof cmd !== 'string') {
        return res.status(400).json({ error: 'Missing app command' });
      }

      const baseCmd = cmd.trim().split(/\s+/)[0];
      if (!baseCmd) {
        return res.status(400).json({ error: 'Invalid app command' });
      }

      if (!safeCommandName(baseCmd)) {
        return res.status(400).json({ error: 'Unsafe app command' });
      }

      const exists = await commandExists(baseCmd);
      if (!exists) {
        return res.status(404).json({ error: `Command not found: ${baseCmd}` });
      }

      const child = require('child_process').spawn(cmd, [], { 
        shell: true, 
        detached: true, 
        stdio: 'ignore',
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
      });
      child.unref();
      res.json({ success: true, launched: cmd });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- TERMINAL ---
  app.post("/api/system/terminal", async (req, res) => {
    try {
      const { command } = req.body;
      const allowUnsafeTerminal = process.env.ENABLE_UNSAFE_TERMINAL === 'true';
      if (!allowUnsafeTerminal) {
        const safeCommands = ['help', 'date', 'uptime', 'whoami', 'pwd', 'ls'];
        if (!safeCommands.includes(command)) {
          return res.json({ output: `Command blocked in safe mode. Allowed: ${safeCommands.join(', ')}` });
        }
      }
      const { stdout, stderr } = await execAsync(command);
      res.json({ output: stdout || stderr });
    } catch (error: any) { 
      res.json({ output: error.message }); 
    }
  });

  // --- SYSTEM MONITOR (CPU & RAM) ---
  let lastCpu = { idle: 0, total: 0 };
  app.get("/api/system/monitor", async (req, res) => {
    try {
      const meminfo = fs.existsSync("/proc/meminfo") ? fs.readFileSync("/proc/meminfo", "utf-8") : "";
      const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
      const memAvailMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
      
      let ramUsage = 0, memTotal = 0, memAvail = 0;
      if (memTotalMatch && memAvailMatch) {
        memTotal = parseInt(memTotalMatch[1], 10);
        memAvail = parseInt(memAvailMatch[1], 10);
        ramUsage = ((memTotal - memAvail) / memTotal) * 100;
      }

      const stat = fs.existsSync("/proc/stat") ? fs.readFileSync("/proc/stat", "utf-8") : "";
      const cpuMatch = stat.match(/^cpu\s+(.*)$/m);
      let cpuUsage = 0;
      if (cpuMatch) {
        const parts = cpuMatch[1].trim().split(/\s+/).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        
        const idleDiff = idle - lastCpu.idle;
        const totalDiff = total - lastCpu.total;
        if (totalDiff > 0) {
          cpuUsage = 100 * (1 - idleDiff / totalDiff);
        }
        lastCpu = { idle, total };
      }

      res.json({ cpu: cpuUsage, ram: ramUsage, memTotal, memAvail });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- PACKAGE MANAGER (Pacman) ---
  app.get("/api/system/packages/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        // Return installed packages if no query
        try {
          const { stdout } = await execAsync(`pacman -Q`);
          const lines = stdout.split('\n').filter(Boolean);
          const packages = lines.map(line => {
            const [name, version] = line.split(' ');
            return { name, version, description: 'Installed package', installed: true };
          });
          return res.json({ packages });
        } catch (e) {
          return res.json({ packages: [] });
        }
      }
      if (typeof q !== 'string' || !q.trim()) {
        return res.json({ packages: [] });
      }
      if (!safePackageName(q)) {
        return res.status(400).json({ error: 'Invalid search query' });
      }
      const { stdout } = await execAsync(`pacman -Ss ${q}`);
      const lines = stdout.split('\n');
      const packages = [];
      for (let i = 0; i < lines.length; i += 2) {
        if (!lines[i] || !lines[i].includes('/')) continue;
        const [repoAndName, version, ...rest] = lines[i].split(' ');
        const installed = rest.join(' ').includes('[installed');
        const description = lines[i+1]?.trim() || '';
        packages.push({ name: repoAndName.split('/')[1] || repoAndName, version, description, installed: !!installed });
      }
      res.json({ packages });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/system/packages/install", async (req, res) => {
    try {
      const { pkg } = req.body;
      if (!pkg || typeof pkg !== 'string' || !safePackageName(pkg)) {
        return res.status(400).json({ error: 'Invalid package name' });
      }
      const { stdout } = await execAsync(`pkexec pacman -S --noconfirm ${pkg}`);
      res.json({ success: true, output: stdout });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/system/packages/uninstall", async (req, res) => {
    try {
      const { pkg } = req.body;
      if (!pkg || typeof pkg !== 'string' || !safePackageName(pkg)) {
        return res.status(400).json({ error: 'Invalid package name' });
      }
      const { stdout } = await execAsync(`pkexec pacman -Rns --noconfirm ${pkg}`);
      res.json({ success: true, output: stdout });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/system/packages/installed", async (req, res) => {
    try {
      const { stdout } = await execAsync(`pacman -Q`);
      const packages = stdout.split('\n').filter(l => l.trim()).map(line => {
        const [name, version] = line.split(' ');
        return { name, version };
      });
      res.json({ packages });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
