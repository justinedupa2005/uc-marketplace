import { z } from "zod";

import { registrationSchema, resetPasswordSchema, PASSWORD_MAX_LENGTH } from "@/lib/auth/validation";

export const profileDetailsSchema = z.object({
  fullName: registrationSchema.shape.fullName.optional(),
  course: registrationSchema.shape.course.optional(),
  yearLevel: registrationSchema.shape.yearLevel.optional(),
  updatedAt: z.string().datetime({ offset: true, message: "Refresh your profile before saving." }),
});

export const changePasswordSchema = resetPasswordSchema.safeExtend({
  currentPassword: z.string({ error: "Enter your current password." }).min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH, "Current password is too long."),
  nonce: z.string().trim().regex(/^\d{6,10}$/, "Enter the verification code from your email.").optional(),
});

export function getProfileFieldErrors(error: z.ZodError) {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") (fields[field] ??= []).push(issue.message);
  }
  return fields;
}
