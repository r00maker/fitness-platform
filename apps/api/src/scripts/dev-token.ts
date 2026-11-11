/** Development only: print a sign-in token for a user so you can try the API with curl. */
import { SignJWT } from "jose";

const [userId, orgId] = process.argv.slice(2);
const secret = process.env.AUTH_DEV_SECRET;
if (process.env.NODE_ENV === "production" || !secret) throw new Error("Dev tokens are only for local development");
if (!userId || !orgId) throw new Error("Usage: pnpm dev:token <userId> <orgId>");
const token = await new SignJWT({ org: orgId })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(new TextEncoder().encode(secret));
console.log(token);
