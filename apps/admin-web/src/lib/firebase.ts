import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
export const emulator = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const config = {
  apiKey: "AIzaSyAxkBlbFn0j5Q71Rc4RSLuz8yGlBc-v0pQ",
  authDomain: "ghostai-794c5.firebaseapp.com",
  projectId: "ghostai-794c5",
  storageBucket: "ghostai-794c5.firebasestorage.app",
  messagingSenderId: "289348696990",
  appId: "1:289348696990:web:f47164a4020d7d0585348f",
  measurementId: "G-1NMDVCZNMS",
};
export const projectId = emulator ? "demo-ghostai" : config.projectId;
// Separate persistence namespaces prevent emulator users being reused in live mode.
const appName = emulator ? "ghostai-local" : "ghostai-live";
const app = getApps().some((app) => app.name === appName)
  ? getApp(appName)
  : initializeApp({ ...config, projectId }, appName);
export const auth = getAuth(app);
// Emulator connection is idempotent across Next.js hot reloads.
if (emulator && !auth.emulatorConfig)
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
export const authReady =
  typeof window !== "undefined"
    ? setPersistence(auth, browserSessionPersistence)
    : Promise.resolve();
const region = process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? "us-central1";
export const apiBase = emulator
  ? `http://127.0.0.1:5001/${projectId}/${region}/api`
  : `https://${region}-${projectId}.cloudfunctions.net/api`;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError("Please sign in.", 401);
  const response = await fetch(`${apiBase}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error ?? "Something went wrong.",
      response.status,
    );
  return result as T;
}
