import Link from "next/link";

function visiblePages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages]);

  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page);
  }

  return [...pages].sort((first, second) => first - second);
}

export function Pagination({
  currentPage,
  totalPages,
  hrefForPage,
  ariaLabel = "Result pages",
}: {
  currentPage: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  ariaLabel?: string;
}) {
  if (totalPages <= 1) return null;

  const selectedPage = Math.min(Math.max(currentPage, 1), totalPages);
  const pages = visiblePages(selectedPage, totalPages);

  return (
    <nav
      aria-label={ariaLabel}
      className="mt-8 flex flex-wrap items-center justify-center gap-2"
    >
      {selectedPage > 1 ? (
        <Link
          href={hrefForPage(selectedPage - 1)}
          rel="prev"
          className="inline-flex min-h-11 items-center rounded-md border border-[#c4c5d5] bg-white px-4 text-sm font-semibold text-[#0038a8] hover:border-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center rounded-md border border-[#e1e2ea] bg-[#f2f3f8] px-4 text-sm font-semibold text-[#8a8c98]"
        >
          Previous
        </span>
      )}

      {pages.map((page, index) => {
        const previousPage = pages[index - 1];
        const hasGap = previousPage !== undefined && page - previousPage > 1;

        return (
          <span key={page} className="contents">
            {hasGap && (
              <span aria-hidden="true" className="px-1 text-[#747685]">
                &hellip;
              </span>
            )}
            <Link
              href={hrefForPage(page)}
              aria-label={`Page ${page}`}
              aria-current={page === selectedPage ? "page" : undefined}
              className={`inline-flex size-11 items-center justify-center rounded-md border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] ${
                page === selectedPage
                  ? "border-[#0038a8] bg-[#0038a8] text-white"
                  : "border-[#c4c5d5] bg-white text-[#0038a8] hover:border-[#0038a8] hover:bg-[#edf2ff]"
              }`}
            >
              {page}
            </Link>
          </span>
        );
      })}

      {selectedPage < totalPages ? (
        <Link
          href={hrefForPage(selectedPage + 1)}
          rel="next"
          className="inline-flex min-h-11 items-center rounded-md border border-[#c4c5d5] bg-white px-4 text-sm font-semibold text-[#0038a8] hover:border-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center rounded-md border border-[#e1e2ea] bg-[#f2f3f8] px-4 text-sm font-semibold text-[#8a8c98]"
        >
          Next
        </span>
      )}
    </nav>
  );
}
