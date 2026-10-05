# Idle Shutdown Guardian

A small program that switches your Windows PC off by itself once Plex and RDT-Client have had nothing to do for an hour. It also switches the PC off every night at 1am, whatever is going on.

## Goals

1. **Switch the PC off when nobody is using it**, so it is not left running all night and you do not have to remember to do it.
2. **Never interrupt anything real.** It only shuts down after confirming, 60 checks in a row, that nothing is downloading and nobody is watching. If it is ever unsure, it leaves the PC on. The one exception is the nightly 1am shutdown, which ignores all of that and which you can switch off.
3. **Run by itself.** Set it up once, have it start with the PC, and forget about it.
4. **Keep you in control.** There is a 60 second warning before the PC goes off, a one-line command to cancel it, and a practice mode that never shuts anything down.
5. **Stay simple.** One small program, no database, no accounts to create. Passwords live in one private settings file, never in the code.

It deliberately does not watch for other things you might be doing on the PC (browsing, playing games at the PC itself, working), it does not switch the PC back on, and it does not change anything in Plex or RDT-Client: it only asks them questions. It also does not cancel a shutdown for you if something starts during the 60 second warning. You do that yourself (see "Commands you may need"). It does not yet know about Moonlight game streams from Sunshine, which is covered under "Next steps: Sunshine and Moonlight" below.

## How it works

Think of a night watchman doing a round once a minute.

1. He asks **RDT-Client**: "Is anything downloading right now?"
2. He asks **Plex**: "Is anyone watching something right now?"
3. If either says yes, he forgets any quiet time he had counted and starts again from zero.
4. If both say no, he adds one to a tally of quiet rounds.
5. When the tally reaches 60 (an hour of quiet), he tells Windows to shut down. Windows shows a 60 second countdown, and you can cancel it.

A few details worth knowing:

- **Downloading** means RDT-Client reports a torrent with a download speed above zero, or with a status of downloading. Stalled or queued torrents do not count.
- **Watching** means Plex lists at least one session. A paused film still counts, because Plex still lists it.
- **If it cannot get an answer** (Plex is switched off, a password is wrong, the network blips), it does not assume things are quiet. It resets the tally, writes the problem to the log and tries again a minute later. The side effect is that if Plex or RDT-Client is not running, the PC will not shut itself down.
- **After it starts a shutdown** the tally goes back to zero, so if you cancel you get another full hour.
- **The 1am shutdown ignores all of the above.** On its first round between 01:00 and 01:59 by the PC's own clock, it tells Windows to shut down, even if something is downloading, someone is watching, or Plex cannot be reached. It does this once a night, so if you cancel it, it leaves you alone until the next night. If you switch the PC on during that hour, it will shut down again within a minute, so cancel it (or set `NIGHTLY_SHUTDOWN=false`) when you want to stay up.
- **Every condition has an on/off switch** in `.env`: `RDT_CHECK`, `PLEX_CHECK` and `NIGHTLY_SHUTDOWN` (see "All the settings"). A switched-off check is not asked at all, so it can neither keep the PC on nor count as "cannot get an answer".
- It logs in to RDT-Client the same way Sonarr and Radarr do.

## What you need

- A Windows PC that runs Plex and RDT-Client. Run the guardian on that same PC, because it shuts down the PC it is running on. (On a Mac or Linux machine it only runs in practice mode.)
- Node.js 20.12 or newer. Type `node --version` in a terminal to check, and install the current LTS version from nodejs.org if it is older or missing.
- The username and password you use to log in to RDT-Client's web page.
- Your Plex token (how to find it is below).

## Setting it up

Open PowerShell in the project folder, the one containing `package.json`. In File Explorer you can open the folder, click the address bar, type `powershell` and press Enter. Then work through these steps.

**1. Install what it needs.** You only do this once.

```
npm install
```

**2. Create your settings file.** In the same folder, create a file called `.env` (the dot at the front is part of the name) containing:

```
RDT_USERNAME=your-rdt-client-username
RDT_PASSWORD=your-rdt-client-password
PLEX_TOKEN=your-plex-token
DRY_RUN=true
```

The easiest way is to run `notepad .env` and click Yes when it offers to create the file. Afterwards check that Windows has not named it `.env.txt`. If your password contains `#` or spaces, put it in double quotes.

`DRY_RUN=true` is practice mode: it checks and counts as normal, but only says it would shut down. Leave it on until you have worked through "Checking that it behaves" below.

**3. Build it.** This turns the code into the version that actually runs, which appears in a `dist` folder. Repeat it whenever the code changes.

```
npm run build
```

**4. Start it.**

```
npm start
```

You should see a line saying the guardian has started, then a new line every minute. Press `Ctrl+C` to stop it.

### Finding your Plex token

1. Sign in to Plex in your web browser.
2. Open any film or episode, click the `...` menu, choose **Get Info**, then **View XML**.
3. Look at the address bar of the page that opens. The token is the text after `X-Plex-Token=` at the end.

Plex's support article "Finding an authentication token / X-Plex-Token" covers this in more detail. Treat the token and your RDT-Client password like passwords: do not share them or paste them into chats. `.env` is already listed in `.gitignore`, so it will not be committed by accident.

### All the settings

These go in `.env`. Changes only take effect after you stop and start the guardian again.

| Setting | Needed? | Default | What it is |
| --- | --- | --- | --- |
| `RDT_USERNAME` | Yes, unless `RDT_CHECK=false` | none | Your RDT-Client login name |
| `RDT_PASSWORD` | Yes, unless `RDT_CHECK=false` | none | Your RDT-Client password |
| `PLEX_TOKEN` | Yes, unless `PLEX_CHECK=false` | none | Plex's access key for your server |
| `RDT_URL` | No | `http://localhost:6500` | The address you type into your browser to open RDT-Client |
| `PLEX_URL` | No | `http://localhost:32400` | The address of your Plex server |
| `POLL_INTERVAL_SECONDS` | No | `60` | How often it checks |
| `IDLE_TIMEOUT_MINUTES` | No | `60` | How long things must stay quiet before it shuts down |
| `DRY_RUN` | No | `false` | `true` means practice mode: log only, never shut down |
| `RDT_CHECK` | No | `true` | `false` stops it asking RDT-Client, so downloads no longer keep the PC on |
| `PLEX_CHECK` | No | `true` | `false` stops it asking Plex, so streams no longer keep the PC on |
| `NIGHTLY_SHUTDOWN` | No | `true` | `false` turns off the 1am shutdown |

The on/off settings accept `true` or `false` (`1`/`0` and `yes`/`no` also work). If you turn off both `RDT_CHECK` and `PLEX_CHECK`, nothing can ever count as activity, so the PC shuts down once `IDLE_TIMEOUT_MINUTES` has passed. The guardian says so in the log when it starts.

The number of quiet checks needed is `IDLE_TIMEOUT_MINUTES` multiplied by 60, divided by `POLL_INTERVAL_SECONDS`, rounded up. With the defaults that is 60 checks, one a minute.

## Checking that it behaves

Keep `DRY_RUN=true` for steps 1 to 6. Each log line starts with the date and time. For a faster test, temporarily add `POLL_INTERVAL_SECONDS=10` to `.env` and restart.

**1. Quiet.** With nothing downloading and nothing playing, the tally climbs:

```
2026-10-02T21:04:11.730Z Idle 1/60. rdt=idle (downloading: 0 of 3), plex=idle (active sessions: 0)
2026-10-02T21:05:11.741Z Idle 2/60. rdt=idle (downloading: 0 of 3), plex=idle (active sessions: 0)
```

**2. RDT-Client sees downloads.** Start a download in RDT-Client. Within a check or two the line should say `rdt=active` and the tally resets:

```
2026-10-02T21:06:11.802Z Activity detected, idle counter reset. rdt=active (downloading: 1 of 4), plex=idle (active sessions: 0)
```

**3. Plex sees streams.** Play something in Plex. The line should say `plex=active (active sessions: 1)`.

**4. It plays safe when it cannot ask.** Stop Plex, or put a wrong token in `.env` and restart the guardian. The line should start with `ERROR`, say `plex=unavailable`, and the tally should not climb:

```
2026-10-02T21:07:11.655Z ERROR Could not confirm idle, idle counter reset. rdt=idle (downloading: 0 of 3), plex=unavailable (Plex returned HTTP 401)
```

**5. It decides to shut down.** Set `IDLE_TIMEOUT_MINUTES=1` and `POLL_INTERVAL_SECONDS=10` (that is 6 quiet checks), restart, leave everything quiet and wait about a minute. In practice mode it says what it would do, and nothing is shut down:

```
2026-10-02T21:08:12.011Z Idle timeout of 1 min reached, shutting down.
2026-10-02T21:08:12.012Z DRY_RUN is on, not running: shutdown /s /t 60 /c "Idle timeout reached. Shutting down in 60 seconds."
```

**6. The 1am shutdown.** Leave the guardian running in practice mode past 1am. The first round of the hour should log this, and it should appear once, not every minute:

```
2026-10-03T01:00:12.011Z Nightly shutdown hour (01:00) reached, shutting down regardless of activity.
2026-10-03T01:00:12.012Z DRY_RUN is on, not running: shutdown /s /t 60 /c "Nightly shutdown time reached. Shutting down in 60 seconds."
```

The hour is judged by the PC's own clock, but log timestamps are always in UTC (the `Z`), so they only read 01:00 if your time zone is UTC.

**7. The real thing (optional).** Save your work first. Set `DRY_RUN=false`, keep the short timings from step 5, restart and leave things quiet. After about a minute Windows shows a 60 second countdown and the guardian logs `Shutdown scheduled in 60 seconds`. Open a second terminal and run `npm run cancel` to stop it. If you do not, the PC really will shut down. The short timings are still on, so it will try again a minute later: press `Ctrl+C` in the guardian's window to stop it.

When you are happy, remove the short timings from `.env`, set `DRY_RUN=false` (or delete that line) and start the guardian again.

## Running it all the time

The simplest way to start it with the PC is Task Scheduler.

1. Open **Task Scheduler** and choose **Create Task** (not "Create Basic Task").
2. On **General**, give it a name such as "Idle Shutdown Guardian" and choose **Run whether user is logged on or not**. Without that, Windows will not run the task at boot. It asks for your password when you save (if you sign in with a PIN, use your Microsoft account password).
3. On **Triggers**, add one that begins the task **At startup**. Add a second that begins it **At log on** of any user, as a backup for PCs where "At startup" is skipped. The default setting "Do not start a new instance" stops two copies running.
4. On **Actions**, add **Start a program** with these values, changing the folder to wherever the project lives:
   - Program/script: `cmd.exe`
   - Add arguments: `/c "node dist\index.js >> guardian.log 2>&1"`
   - Start in: `C:\path\to\auto-shutdown`
5. On **Settings**, untick **Stop the task if it runs longer than**. It is on by default, set to 3 days, and the guardian is meant to run for ever. On a laptop, also untick **Start the task only if the computer is on AC power** on **Conditions**.
6. Save it, then right-click the task and choose **Run**.

Task Scheduler does not show the program's output, so the arguments above send it to a file called `guardian.log` in the project folder. Open that file to see what the guardian is doing. After changing `.env` or rebuilding, end the task and run it again.

PM2 also works (`npm install -g pm2`, then `pm2 start dist/index.js --name idle-shutdown`, and `pm2 logs idle-shutdown` to watch it). On Windows it needs an extra add-on to start at boot, which is why Task Scheduler is simpler.

### Checking it starts at boot

Restart the PC, wait a couple of minutes, then check two things.

1. In Task Scheduler, select the task and look at **Last Run Time** and **Last Run Result**. You want a time just after the boot and `0x41301`, which means "currently running". `0x41303` means it never ran, `0x800710E0` means a Conditions setting blocked it, `0x8007010B` means the **Start in** folder is wrong, and `0x2331` means Windows could not find `node`.
2. In PowerShell, in the project folder, run `Get-Content .\guardian.log -Tail 20`. The guardian logs every minute, so the newest line should be under a minute old. If there is no `guardian.log` there, look in `C:\Windows\System32`, where it ends up when **Start in** is left blank.

If the task never ran, choose **Action**, then **Enable All Tasks History** in Task Scheduler, restart, and read the task's **History** tab for the reason. If it only starts after a Restart, and not after Shut down and power on, Windows Fast Startup may be skipping the "At startup" trigger, which the log-on trigger above covers. The full step-by-step list is in `diagnose.txt`.

## Commands you may need

| Command | What it does |
| --- | --- |
| `node --version` | Shows your Node.js version, which needs to be 20.12 or newer |
| `npm install` | Downloads the tools the project needs. Once, or after getting a fresh copy |
| `npm run build` | Compiles the code into the `dist` folder. Repeat after any code change |
| `npm start` | Starts the guardian in the current window. `Ctrl+C` stops it |
| `npm run cancel` | Cancels a shutdown that is counting down. It runs `shutdown /a`, which you can also type yourself |

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `RDT_USERNAME is not set` (or `RDT_PASSWORD`, `PLEX_TOKEN`) | That value is missing or empty in `.env`, or `.env` is not in the project folder |
| `RDT-Client login rejected` | Wrong username or password, or `RDT_URL` is not RDT-Client's address |
| `RDT-Client returned HTTP 404` | The address is wrong, or this RDT-Client does not offer the Sonarr and Radarr style interface the guardian uses |
| `Plex returned HTTP 401` | The Plex token is wrong or has changed |
| `fetch failed` followed by `ECONNREFUSED` | That program is not running, or the address or port in `.env` is wrong |
| `RDT_URL must be a full address` (or `PLEX_URL`) | The address needs `http://` at the front, for example `http://localhost:6500` |
| `The operation was aborted due to timeout` | The program took more than 10 seconds to answer |
| `DRY_RUN must be true or false` (or `RDT_CHECK`, `PLEX_CHECK`, `NIGHTLY_SHUTDOWN`) | That on/off setting in `.env` has some other value. Use `true` or `false` |
| The PC shut down at 1am while you were using it | That is the nightly shutdown. Run `npm run cancel` to stop it (it will not try again until tomorrow), or set `NIGHTLY_SHUTDOWN=false` |
| `Shutdown is only implemented for Windows` | You are on a Mac or Linux machine. Set `DRY_RUN=true` to test there |
| The tally never reaches the target | Look at the log: something is reporting `active`. A paused Plex stream or a stuck download counts as busy |

## Next steps: Sunshine and Moonlight

**Status: not built yet.** The guardian does not currently know about Moonlight game streams, so it can shut the PC down mid-stream if Plex and RDT-Client have both been quiet for an hour. Until this is added, keep `DRY_RUN=true` while you stream, or stop the guardian first.

The aim is a third question on the watchman's round, "Is a Moonlight client streaming from Sunshine right now?", where a stream counts as activity just like a download or a Plex session.

The plan, in order:

1. **Check how Sunshine behaves on your PC.** The idea relies on Sunshine opening its streaming ports (UDP 47998, 47999 and 48000 by default) only while a client is connected. That is how Sunshine is understood to work, not something confirmed on your machine, so check it before any code is written. Start a Moonlight stream, then in a second terminal run `netstat -ano | findstr ":47998 :47999 :48000"`. You should see UDP lines while streaming and nothing once you disconnect. Note down what you see.
2. **Note your Sunshine settings.** Open Sunshine's web page (`https://localhost:47990` by default) and note its version and the "Port" setting under Configuration, then Network (47989 by default). The streaming ports sit 9, 10 and 11 above that port, so if you have changed it the numbers in step 1 change too.
3. **Build the check.** If step 1 shows the ports opening and closing with the stream, add a Sunshine check that looks for them on every round using Windows' `netstat`. It needs no Sunshine login. It would add two settings to `.env`: `SUNSHINE_CHECK` (on by default on Windows) and `SUNSHINE_BASE_PORT` (default `47989`).
4. **Test it like the other checks.** With `DRY_RUN=true`, start a stream and the log line should say `sunshine=active`. Close the stream and it should return to `idle` within a minute or so.

If step 1 shows nothing during a stream, the port approach will not work on your setup. The fallbacks are:

- **Sunshine's web interface.** It needs the web page's username and password and has to cope with its self-signed certificate. It is not confirmed that it can say who is streaming.
- **Sunshine's Command Preparations** (Configuration, then General). Sunshine can run one command when a stream's app starts and another when it ends, which could create and delete a flag file for the guardian to check. This follows the app rather than the connection, so it can still read as streaming after you disconnect without quitting the app.

## What is in the folder

| File | Its job |
| --- | --- |
| `src/index.ts` | The watchman: runs the checks every minute, keeps the tally and decides when to shut down, including at 1am |
| `src/rdt.ts` | Asks RDT-Client whether anything is downloading |
| `src/plex.ts` | Asks Plex whether anyone is watching |
| `src/shutdown.ts` | Runs the Windows shutdown command |
| `src/config.ts` | Reads your settings from `.env` |
| `src/log.ts`, `src/activity.ts` | Small helpers for log lines and the shape of a check's answer |
| `dist/` | The built version that actually runs, made by `npm run build` |
| `.env` | Your private settings, which you create |
| `diagnose.txt` | Step-by-step help for when the guardian does not start at boot |
