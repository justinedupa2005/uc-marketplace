import { z } from "zod";

import { isAcceptedCourse } from "@/lib/auth/options";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`,
  )
  .max(PASSWORD_MAX_LENGTH, "Password is too long.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

export const registrationSchema = z
  .object({
    fullName: z
      .string({ error: "Enter your full name." })
      .trim()
      .min(2, "Enter your full name.")
      .max(100, "Your name is too long."),
    studentIdNumber: z
      .string({ error: "Enter your student ID number." })
      .trim()
      .min(4, "Student ID number must contain at least 4 characters.")
      .max(50, "Student ID number is too long.")
      .regex(
        /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/,
        "Use letters and numbers, with single hyphens only between groups.",
      )
      .transform((studentIdNumber) => studentIdNumber.toUpperCase()),
    course: z
      .string({ error: "Select your course." })
      .trim()
      .refine(isAcceptedCourse, "Select a valid course."),
    yearLevel: z.coerce
      .number({ error: "Select your year level." })
      .int("Select a valid year level.")
      .min(1, "Select your year level.")
      .max(5, "Select a valid year level."),
    email: z
      .string({ error: "Enter a valid email address." })
      .trim()
      .email("Enter a valid email address.")
      .max(254, "Email address is too long.")
      .transform((email) => email.toLowerCase()),
    password: passwordSchema,
    confirmPassword: z
      .string({ error: "Confirm your password." })
      .max(PASSWORD_MAX_LENGTH, "Password confirmation is too long."),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z
      .string({ error: "Confirm your new password." })
      .max(PASSWORD_MAX_LENGTH, "Password confirmation is too long."),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
