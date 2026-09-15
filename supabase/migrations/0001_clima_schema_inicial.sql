-- Schema proprio para o projeto "Clima Brasilia - Hoje x Passado".
-- Isolado do schema public para nao se misturar com as tabelas do site.
-- Aplicado em 15/09/2026 no projeto frsidsdrexolvcfxzroe.
create schema if not exists clima;

-- Serie diaria consolidada: uma linha por dia, venha de onde vier.
create table if not exists clima.clima_diario (
  data           date primary key,
  fonte          text not null default 'inmet_a001'
                 check (fonte in ('inmet_a001', 'open_meteo', 'estacao_caseira')),
  temp_max       numeric(4,1),
  temp_min       numeric(4,1),
  temp_media     numeric(4,1),
  chuva_mm       numeric(6,1) check (chuva_mm >= 0),
  umidade_media  numeric(5,1) check (umidade_media between 0 and 100),
  umidade_min    numeric(5,1) check (umidade_min between 0 and 100),
  pressao_media  numeric(6,1),
  vento_medio    numeric(5,1) check (vento_medio >= 0),
  rajada_max     numeric(5,1) check (rajada_max >= 0),
  horas_validas  smallint check (horas_validas between 0 and 24),
  atualizado_em  timestamptz not null default now()
);

comment on table clima.clima_diario is
  'Um registro por dia local (UTC-3). fonte diz de onde veio o dado.';
comment on column clima.clima_diario.horas_validas is
  'Horas com leitura de temperatura no dia; abaixo de 24 o dia esta incompleto.';

-- A tela busca "o mesmo dia do ano em todos os anos": indexa mes e dia.
create index if not exists clima_diario_mes_dia_idx
  on clima.clima_diario (date_part('month', data), date_part('day', data));

-- Fase 2: leituras cruas da estacao caseira (ESP32).
create table if not exists clima.leituras_estacao (
  id             bigint generated always as identity primary key,
  dispositivo    text not null default 'esp32-01',
  medido_em      timestamptz not null,
  recebido_em    timestamptz not null default now(),
  temp_c         numeric(5,2),
  umidade        numeric(5,2) check (umidade between 0 and 100),
  pressao_hpa    numeric(7,2),
  vento_ms       numeric(5,2) check (vento_ms >= 0),
  rajada_ms      numeric(5,2) check (rajada_ms >= 0),
  direcao_graus  numeric(5,1) check (direcao_graus between 0 and 360),
  chuva_mm       numeric(6,2) check (chuva_mm >= 0),
  unique (dispositivo, medido_em)
);

comment on table clima.leituras_estacao is
  'Leituras cruas da estacao caseira. medido_em e o relogio do ESP32; recebido_em, o do servidor.';

create index if not exists leituras_estacao_medido_em_idx
  on clima.leituras_estacao (medido_em desc);

-- RLS: leitura publica, escrita so pelo service role (que ignora RLS).
alter table clima.clima_diario     enable row level security;
alter table clima.leituras_estacao enable row level security;

drop policy if exists leitura_publica on clima.clima_diario;
create policy leitura_publica on clima.clima_diario
  for select to anon, authenticated using (true);

drop policy if exists leitura_publica on clima.leituras_estacao;
create policy leitura_publica on clima.leituras_estacao
  for select to anon, authenticated using (true);

-- Acesso de leitura pela API. Nenhum grant de escrita: so o service role grava.
grant usage on schema clima to anon, authenticated;
grant select on clima.clima_diario, clima.leituras_estacao to anon, authenticated;

-- ATENCAO, passo manual: para a API REST enxergar este schema, adicione "clima"
-- em Dashboard > Project Settings > API > Exposed schemas. Sem isso o front
-- recebe PGRST106 "Invalid schema: clima".
