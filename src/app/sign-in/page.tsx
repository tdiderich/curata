"use client";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <h1>Sign in to curata</h1>
        <button onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
          Sign in with Google
        </button>
        <button onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/dashboard" })}>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
