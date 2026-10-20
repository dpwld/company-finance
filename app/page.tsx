import { requireChatGPTUser } from "./chatgpt-auth";
import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";
import { CurrentUserProvider } from "@/lib/auth/CurrentUserContext";
export default async function Home() { const user = await requireChatGPTUser("/"); return <CurrentUserProvider user={{ id: user.userId, key: user.userId, name: user.displayName, email: user.email, displayName: user.displayName, fullName: user.fullName || user.displayName }}><FinanceWorkspace /></CurrentUserProvider>; }
