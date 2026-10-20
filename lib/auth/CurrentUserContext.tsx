"use client";
import { createContext, useContext } from "react";
export type User = {
    id: string;
    key: string;
    name: string;
    email: string;
    displayName: string;
    fullName: string;
};
const Context = createContext<User | null>(null);
export function CurrentUserProvider({ user, children }: {
    user: User;
    children: React.ReactNode;
}) { return <Context.Provider value={user}>{children}</Context.Provider>; }
export function useCurrentUser(): User { const user = useContext(Context); if (!user)
    throw new Error("Sign in to continue."); return user; }
