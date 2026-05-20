import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"
import { z } from "zod"

const ContactSchema = z.looseObject({
  public_key: z.string().optional(),
  adv_name: z.string().optional(),
  type: z.number().optional(),
  adv_lat: z.number().nullable().optional(),
  adv_lon: z.number().nullable().optional(),
  out_path_len: z.number().nullable().optional(),
  out_path: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  flags: z.number().nullable().optional(),
  last_advert: z.number().nullable().optional(),
})

const ContactsMap = z.record(z.string(), ContactSchema)

const ContactStatsRowSchema = z.object({
  first_msg_at: z.string().nullable(),
  last_msg_at: z.string().nullable(),
  msg_count: z.number().int().nonnegative(),
})
const ContactsStatsMap = z.record(z.string(), ContactStatsRowSchema)
export type ContactStatsRow = z.infer<typeof ContactStatsRowSchema>
export type ContactsStatsMap = z.infer<typeof ContactsStatsMap>

const ImportResponse = z.looseObject({
  contact: ContactSchema.optional(),
}).or(ContactSchema)
const ShareResponse = z.object({ uri: z.string() })
const FlagsResponse = z.object({ flags: z.number() })
const TelemetryResponse = z.looseObject({})
const PingResponse = z.looseObject({})
const AclResponse = z.looseObject({})

export type Contact = z.infer<typeof ContactSchema>
export type ContactsMap = z.infer<typeof ContactsMap>

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.get("/api/contacts", ContactsMap),
    staleTime: 60_000,
  })
}

export function useContactsStats() {
  return useQuery({
    queryKey: ["contacts", "stats"],
    queryFn: () => api.get("/api/contacts/stats", ContactsStatsMap),
    staleTime: 30_000,
  })
}

/**
 * Returns a single contact by pubkey from the cached contacts map.
 * Shares the same query as useContacts (no extra network call).
 */
export function useContact(pubkey: string | undefined) {
  const { data, ...rest } = useContacts()
  const contact = pubkey && data ? (data[pubkey] ?? null) : null
  return { contact, ...rest }
}

export function useImportContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ uri }: { uri: string }) => {
      return api.post("/api/contacts/import", { uri }, ImportResponse)
    },
    onSuccess: () => {
      toast.success("Contact imported")
      qc.invalidateQueries({ queryKey: ["contacts"] })
    },
    onError: (e) => notifyError("Import", e),
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.delete(`/api/contacts/${pubkey}`),
    onSuccess: () => {
      toast.success("Contact removed")
      qc.invalidateQueries({ queryKey: ["contacts"] })
    },
    onError: (e) => notifyError("Remove", e),
  })
}

export function useShareContact() {
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.get(`/api/contacts/${pubkey}/share`, ShareResponse),
    onError: (e) => notifyError("Share", e),
  })
}

interface FlagsArgs {
  pubkey: string
  starred?: boolean
  tel_l?: boolean
  tel_a?: boolean
}

export function useSetFlags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pubkey, ...body }: FlagsArgs) =>
      api.patch(`/api/contacts/${pubkey}/flags`, body, FlagsResponse),
    onMutate: async ({ pubkey, starred, tel_l, tel_a }) => {
      await qc.cancelQueries({ queryKey: ["contacts"] })
      const prev = qc.getQueryData<ContactsMap>(["contacts"])
      if (prev && prev[pubkey]) {
        const contact = prev[pubkey]
        let flags = contact.flags ?? 0
        if (starred != null) flags = starred ? flags | 0x01 : flags & ~0x01
        if (tel_l != null) flags = tel_l ? flags | 0x02 : flags & ~0x02
        if (tel_a != null) flags = tel_a ? flags | 0x04 : flags & ~0x04
        qc.setQueryData<ContactsMap>(["contacts"], {
          ...prev,
          [pubkey]: { ...contact, flags },
        })
      }
      return { prev }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["contacts"], ctx.prev)
      notifyError("Flags update", e)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] })
    },
  })
}

export function useRequestTelemetry() {
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.post(`/api/contacts/${pubkey}/telemetry`, {}, TelemetryResponse),
    onSuccess: () => toast.success("Telemetry received"),
    onError: (e) => notifyError("Telemetry", e),
  })
}

export function usePingContact() {
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.post(`/api/contacts/${pubkey}/ping`, {}, PingResponse),
    onSuccess: () => toast.success("Ping received"),
    onError: (e) => notifyError("Ping", e),
  })
}

export function useRequestACL() {
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.post(`/api/contacts/${pubkey}/acl`, {}, AclResponse),
    onSuccess: () => toast.success("ACL received"),
    onError: (e) => notifyError("ACL request", e),
  })
}

export function useDiscoverPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.post(`/api/contacts/${pubkey}/path/discover`, {}),
    onSuccess: () => {
      toast.success("Path discovery sent")
      qc.invalidateQueries({ queryKey: ["contacts"] })
    },
    onError: (e) => notifyError("Path discover", e),
  })
}

export function useResetPath() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pubkey }: { pubkey: string }) =>
      api.post(`/api/contacts/${pubkey}/path/reset`, {}),
    onSuccess: () => {
      toast.success("Path reset to flood")
      qc.invalidateQueries({ queryKey: ["contacts"] })
    },
    onError: (e) => notifyError("Path reset", e),
  })
}
