import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-6 pt-5 sm:px-8 md:px-12 md:py-8 lg:px-16">
        <header className="flex items-center justify-center md:justify-start">
          <Link
            href="/"
            aria-label="UC Exchange home"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[#002576] sm:text-base"
          >
            <Image src="/assets/app/brand.svg" alt="" width={22} height={18} priority />
            <span>UC Exchange</span>
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-9 py-7 md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] md:items-center md:gap-12 md:py-10 lg:gap-20">
          <section className="mx-auto flex w-full max-w-xl flex-col items-center text-center md:mx-0 md:items-start md:text-left">
            <h1 className="max-w-[320px] text-[32px] font-bold leading-[1.08] tracking-[-0.035em] sm:max-w-md sm:text-5xl lg:max-w-xl lg:text-6xl">
              Your secure campus marketplace for UC Main students.
            </h1>

            <p className="mt-5 max-w-[340px] text-sm leading-6 text-[#444653] sm:max-w-lg sm:text-base sm:leading-7">
              Buy and sell textbooks, electronics, and dorm essentials with your peers. All
              transactions and deliveries are handled face-to-face on campus for maximum security.
            </p>

            <div className="mt-7 grid w-full max-w-sm gap-3 sm:grid-cols-2 md:max-w-md">
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center rounded-md bg-[#0038a8] px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
              >
                Register
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-md border-2 border-[#0038a8] bg-white px-6 text-sm font-semibold text-[#0038a8] transition-colors hover:bg-[#e6eeff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
              >
                Log In
              </Link>
            </div>
          </section>

          <section
            aria-label="Safe campus marketplace handoff"
            className="relative mx-auto aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-xl bg-[#d9e3f7] shadow-[0_12px_35px_rgba(0,37,118,0.12)] md:aspect-[5/4] lg:aspect-[4/3]"
          >
            <Image
              src="/assets/landing/campus-handoff.png"
              alt="Two UC students safely exchanging a textbook on campus"
              fill
              sizes="(max-width: 767px) 100vw, 55vw"
              className="object-cover"
              priority
            />

            <div className="absolute bottom-4 left-1/2 flex w-[80%] max-w-xs -translate-x-1/2 items-center gap-3 rounded-lg bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:bottom-6 md:left-6 md:translate-x-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#e6eeff]">
                <Image src="/assets/app/brand.svg" alt="" width={21} height={18} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-xs font-semibold leading-4 text-[#121c2a]">
                  Face-to-Face
                </span>
                <span className="block text-[11px] leading-4 text-[#444653]">
                  Safe Campus Hand-offs
                </span>
              </span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
