import { z } from "zod";

import { isAcceptedCourse } from "@/lib/auth/options";

export const MAX_SCHOOL_ID_BYTES = 5 * 1024 * 1024;

export const SCHOOL_ID_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const studentInformationSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(100),
  studentIdNumber: z
    .string()
    .trim()
    .min(4, "Enter a valid student ID number.")
    .max(50)
    .regex(
      /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/,
      "Use letters and numbers, with hyphens only between groups.",
    )
    .transform((value) => value.toUpperCase()),
  course: z.string().trim().refine(isAcceptedCourse, "Select a valid course."),
  yearLevel: z.coerce.number().int().min(1).max(5),
});

export type StudentInformation = {
  fullName: string;
  studentIdNumber: string;
  course: string;
  yearLevel: number;
};

export function isSupportedSchoolIdImage(file: File) {
  return (
    file.size > 0 &&
    file.size <= MAX_SCHOOL_ID_BYTES &&
    Object.hasOwn(SCHOOL_ID_EXTENSIONS, file.type)
  );
}

export async function hasMatchingImageSignature(file: File) {
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (file.type === "image/jpeg") {
    return (
      signature[0] === 0xff &&
      signature[1] === 0xd8 &&
      signature[2] === 0xff
    );
  }

  if (file.type === "image/png") {
    return (
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a
    );
  }

  if (file.type === "image/webp") {
    return (
      signature[0] === 0x52 &&
      signature[1] === 0x49 &&
      signature[2] === 0x46 &&
      signature[3] === 0x46 &&
      signature[8] === 0x57 &&
      signature[9] === 0x45 &&
      signature[10] === 0x42 &&
      signature[11] === 0x50
    );
  }

  return false;
}
