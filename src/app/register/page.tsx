import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Register | UC Exchange",
  description: "Create your UC Exchange account.",
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9ff] px-5 py-10 text-[#121c2a]">
      <section className="w-full max-w-md rounded-2xl border border-[#c4c5d5]/70 bg-white p-6 shadow-[0_16px_50px_rgba(0,37,118,0.08)] sm:p-9">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#002576]">
          <Image src="/assets/app/brand.svg" alt="" width={22} height={18} />
          UC Exchange
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-[-0.02em]">Create an account</h1>
        <p className="mt-2 text-sm leading-6 text-[#444653]">Join the UC Main student marketplace.</p>

        <form className="mt-7 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Full name</span>
            <input
              type="text"
              name="fullName"
              autoComplete="name"
              required
              className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
            />
          </label>
          <button
            type="submit"
            className="mt-2 h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576]"
          >
            Register
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#444653]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[#0038a8] hover:underline">
            Log In
          </Link>
        </p>
      </section>
    </main>
  );
}
