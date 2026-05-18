import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

const ContactSchema = z
  .object({
    public_key: z.string().optional(),
    adv_name: z.string().optional(),
    type: z.number().optional(),
    adv_lat: z.number().nullable().optional(),
    adv_lon: z.number().nullable().optional(),
    out_path_len: z.number().nullable().optional(),
    last_advert: z.number().nullable().optional(),
  })
  .passthrough()

const ContactsMap = z.record(z.string(), ContactSchema)

export type Contact = z.infer<typeof ContactSchema>
export type ContactsMap = z.infer<typeof ContactsMap>

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.get("/api/contacts", ContactsMap),
    staleTime: 60_000,
  })
}
