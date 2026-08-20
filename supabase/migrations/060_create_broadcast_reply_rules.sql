CREATE TABLE public.broadcast_reply_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    template_name text NOT NULL,
    reply_value text NOT NULL,
    action_type text DEFAULT 'send_text'::text NOT NULL,
    action_text text,
    webhook_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcast_reply_rules_action_type_check CHECK ((action_type = ANY (ARRAY['send_text'::text, 'webhook'::text, 'ai_agent'::text, 'none'::text])))
);

ALTER TABLE public.broadcast_reply_rules OWNER TO postgres;

ALTER TABLE ONLY public.broadcast_reply_rules
    ADD CONSTRAINT broadcast_reply_rules_account_id_template_name_reply_value_key UNIQUE (account_id, template_name, reply_value);

ALTER TABLE ONLY public.broadcast_reply_rules
    ADD CONSTRAINT broadcast_reply_rules_pkey PRIMARY KEY (id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcast_reply_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE ONLY public.broadcast_reply_rules
    ADD CONSTRAINT broadcast_reply_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.broadcast_reply_rules
    ADD CONSTRAINT broadcast_reply_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.broadcast_reply_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY broadcast_reply_rules_delete ON public.broadcast_reply_rules FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));

CREATE POLICY broadcast_reply_rules_insert ON public.broadcast_reply_rules FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));

CREATE POLICY broadcast_reply_rules_select ON public.broadcast_reply_rules FOR SELECT USING (public.is_account_member(account_id));

CREATE POLICY broadcast_reply_rules_update ON public.broadcast_reply_rules FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));

GRANT ALL ON TABLE public.broadcast_reply_rules TO anon;
GRANT ALL ON TABLE public.broadcast_reply_rules TO authenticated;
GRANT ALL ON TABLE public.broadcast_reply_rules TO service_role;
