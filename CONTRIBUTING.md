# Contributing

1. Open an issue describing the problem or intended change. Use synthetic examples and remove private paths and identifiers from logs.
2. Install Node.js 22+, then run `npm ci` and `npm test`.
3. Run `npm start` for the desktop app. Local development state lives in your app data directory and must never be committed.
4. For worker changes, run `python3 -m unittest discover -s tests -p '*_test.py'` on macOS/Linux. Verify affected build/install behavior on a Mac when applicable.
5. For Windows packaging changes, run `npm run dist` and verify a fresh install and existing settings.

Keep runtime configuration, SSH keys, signing credentials, logs, and app source snapshots out of commits. Prefer small changes with meaningful tests for failure handling and boundary validation.

The application currently has a Simplified Chinese interface. English UI localization is welcome; keep technical identifiers and build log content intact.

Contributions are licensed under the project's MIT license.
