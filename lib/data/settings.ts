import { createClient } from "@/lib/transport";
export async function fetchAppSetting(key: string): Promise<string> { const { data, error } = await createClient().from("app_settings").select("value").eq("key", key).maybeSingle(); if (error)
    throw error; return data?.value?.v ?? ""; }
export async function saveAppSetting(key: string, v: string): Promise<void> { const { error } = await createClient().from("app_settings").upsert({ key, value: { v } }); if (error)
    throw error; }
export async function fetchAppSettingJson<T>(key: string): Promise<T | null> { const { data, error } = await createClient().from("app_settings").select("value").eq("key", key).maybeSingle(); if (error)
    throw error; return data?.value ?? null; }
export async function saveAppSettingJson<T>(key: string, value: T): Promise<void> { const { error } = await createClient().from("app_settings").upsert({ key, value }); if (error)
    throw error; }
