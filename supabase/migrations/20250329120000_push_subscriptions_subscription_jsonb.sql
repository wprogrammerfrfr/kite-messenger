-- Store Web Push subscription as a single jsonb (endpoint + keys), matching PushSubscription.toJSON().

alter table public.push_subscriptions add column if not exists subscription jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'endpoint'
  ) then
    execute $backfill$
      update public.push_subscriptions
      set subscription = jsonb_build_object(
        'endpoint', endpoint,
        'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)
      )
      where subscription is null;
    $backfill$;
  end if;
end $$;

alter table public.push_subscriptions drop column if exists endpoint;
alter table public.push_subscriptions drop column if exists p256dh;
alter table public.push_subscriptions drop column if exists auth;

delete from public.push_subscriptions where subscription is null;

alter table public.push_subscriptions alter column subscription set not null;

create unique index if not exists push_subscriptions_subscription_endpoint_uidx
  on public.push_subscriptions ((subscription->>'endpoint'));
