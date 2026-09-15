-- A API REST so enxerga os schemas expostos (public, graphql_public). Em vez de
-- mudar essa configuracao do projeto -- que e compartilhado com o site do
-- luisfilipegdc -- expomos o schema clima por duas views somente leitura.
-- Os dados continuam morando em clima.*; isto e so a vitrine.
-- Para desfazer: drop view public.clima_diario, public.resumo_anual;

create or replace view public.clima_diario
with (security_invoker = true) as
  select data, fonte, temp_max, temp_min, temp_media, chuva_mm, umidade_media,
         umidade_min, pressao_media, vento_medio, rajada_max, horas_validas
  from clima.clima_diario;

create or replace view public.resumo_anual
with (security_invoker = true) as
  select * from clima.resumo_anual;

comment on view public.clima_diario is
  'Vitrine de clima.clima_diario para a API REST. Projeto comparativo-do-clima.';
comment on view public.resumo_anual is
  'Vitrine de clima.resumo_anual para a API REST. Projeto comparativo-do-clima.';

grant select on public.clima_diario, public.resumo_anual to anon, authenticated;
