"use client";

import { useEffect, useRef } from "react";

export function useObjectUrlRegistry() {
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    const activeUrls = objectUrls.current;

    return () => {
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  function createObjectUrl(file: File) {
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    return url;
  }

  function revokeObjectUrl(url: string) {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }

  function revokeAllObjectUrls() {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }

  return { createObjectUrl, revokeObjectUrl, revokeAllObjectUrls };
}
