# Deploying Smart Inventory Assistant

How to install and run the app on a Windows PC so the whole shop can use it over Wi-Fi.

The database stays on this PC, so the PC itself is the server. Phones, tablets and the till open the
app in a browser over the shop's Wi-Fi. **No internet is needed once it is installed**, only for
the downloads in steps 1 to 3 and 6.

Takes about 20 to 30 minutes the first time. Steps 1 to 7 are done **once**; step 8 is how you start
it every day.

---

## 1. Install the software

Install these four, accepting the default options unless a note says otherwise.

| Software | Version | Download | Note |
|---|---|---|---|
| **Node.js** | 18 or newer (LTS) | https://nodejs.org | |
| **MongoDB Community Server** | 7 or newer | https://www.mongodb.com/try/download/community | Keep **"Install MongoD as a Service"** ticked. Compass (the GUI) is optional. |
| **Python** | 3.12 or newer | https://www.python.org/downloads/ | On the first screen, tick **"Add python.exe to PATH"**. |
| **Git** | any | https://git-scm.com/download/win | Only needed to download the code with `git clone`. |

Open a **new** PowerShell window (so it sees the new software) and check each one:

```powershell
node -v              # v18 or higher
npm -v
python --version     # 3.12 or higher
git --version
Get-Service MongoDB  # Status must say Running
```

If MongoDB says `Stopped`, start it with `Start-Service MongoDB` from an **Administrator** PowerShell.

## 2. Download the code

```powershell
cd $HOME\Documents
git clone https://github.com/asighagopi05/smartInventoryAssistant.git
cd smartInventoryAssistant
```

No Git? On the GitHub page click **Code → Download ZIP**, extract it, and `cd` into the extracted folder.

**Every command from here on is run from inside this project folder.**

## 3. Install the app's packages

```powershell
npm run setup
```

This installs the packages for the server and the screens. It takes a minute or two and needs
internet.

## 4. Create the settings file

The server reads its settings from `server/.env`, which is not on GitHub because it holds a secret.
Copy the example file:

```powershell
Copy-Item server\.env.example server\.env
```

Then generate a secret key for logins:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Open `server\.env` in Notepad (`notepad server\.env`), replace `replace_me` after `JWT_SECRET=` with
the long string that was printed, and save. Leave the other lines as they are.

> Never share this file or commit it. Anyone with the secret could forge a login.

## 5. Load the data

```powershell
npm run seed
```

This creates the database with products, suppliers, 90 days of sales and the demo logins (about 10
seconds). It **wipes and rebuilds** the database, so run it only when setting up or when you want a
fresh demo.

Check the data:

```powershell
npm run verify
```

Every line should say it passed.

## 6. Set up the ML service

The ML service powers the **Run** buttons on the Combos and Forecast screens.

```powershell
cd ml
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
deactivate
cd ..
```

`pip install` downloads about 200 MB and takes a few minutes. After this the ML works fully offline.

If you skip this step the app still works; the Combos and Forecast screens show their last saved
results, and only the **Run** buttons are unavailable.

## 7. Allow other devices through the firewall

The first time you start the app (step 8), Windows shows a firewall prompt for **Node.js**. Tick the
network type your Wi-Fi uses (if unsure, tick both **Private** and **Public**) and click
**Allow access**. If you miss it, phones will not be able to connect; see *Troubleshooting*.

## 8. Start the app

```powershell
npm start
```

It builds the screens, then starts everything. When it is ready it prints:

```
  Smart Inventory Assistant
  On this PC:          http://localhost:5000
  On the shop network: http://192.168.1.7:5000

[db] connected to mongodb://127.0.0.1:27017/sia
[api] SIA API listening on http://localhost:5000
```

- On this PC, open **http://localhost:5000**.
- On a phone or another computer **on the same Wi-Fi**, open the **shop network** address. Yours will
  have different numbers.

Keep the PowerShell window open while the shop is using the app. Press **Ctrl+C** to stop it.

**Every day after this**, only step 8 is needed: open PowerShell in the project folder and run
`npm start`. MongoDB starts by itself when Windows starts.

## 9. Log in

| Role | Email | Password |
|---|---|---|
| Owner | `owner@sia.local` | `Owner@123` |
| Manager | `manager@sia.local` | `Manager@123` |
| Staff | `staff1@sia.local` | `Staff@123` |

The login screen also has one-click buttons for these.

## 10. QR codes

The QR codes (Manager → QR Codes) point at the **shop network** address printed in step 8, so a
customer's phone on the shop Wi-Fi can scan them and leave feedback.

That address can change when the router restarts. Before printing QR codes, either reserve this
PC's address in the router settings (often called *DHCP reservation* or *static lease*), or fix the
address yourself when starting:

```powershell
$env:SIA_PUBLIC_URL="http://192.168.1.7:5000"; npm start
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `[db] could not connect` | MongoDB is not running. In an Administrator PowerShell: `Start-Service MongoDB`. |
| ``The `uri` parameter to `openUri()` must be a string, got "undefined"`` | `server\.env` is missing. Do step 4. |
| Login fails with a server error | `JWT_SECRET` in `server\.env` is empty. Do step 4. |
| `EADDRINUSE: address already in use :::5000` | The app is already running in another window, or something else uses port 5000. Close the other window, or use another port: `$env:PORT=8080; npm start`. |
| `[ml] exited with code 3` | Something already uses port 8000, often an old `npm run dev`. Close it and start again. The rest of the app keeps working. |
| `[ml] ml/venv not found` | Do step 6. |
| Works on the PC, but phones cannot open it | Phone and PC must be on the same Wi-Fi (not mobile data). Then allow Node.js through the firewall: **Windows Security → Firewall & network protection → Allow an app through firewall → Change settings**, tick **Node.js** for both Private and Public. Some public or college Wi-Fi networks block devices from reaching each other; a phone hotspot works instead. |
| `npm` or `python` is not recognised | Close PowerShell and open a new one. If it still fails, reinstall that program (for Python, tick *Add python.exe to PATH*). |
| PowerShell says *running scripts is disabled* | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then try again. |
| Screens show old data after editing the code | `npm start` rebuilds them every time, so restart it. |

For development with auto-reload (screens on :5173), use `npm run dev` instead of `npm start`;
see the main [README](../README.md).
