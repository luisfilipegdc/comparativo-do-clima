-- Agregado por ano para os graficos de tendencia: 27 linhas em vez de 9.558 dias.
-- security_invoker: a view respeita a RLS de quem consulta, nao a do dono.
create or replace view clima.resumo_anual
with (security_invoker = true) as
select
  extract(year from data)::int   as ano,
  count(*)                       as dias,
  round(avg(temp_max), 2)        as temp_max_media,
  round(avg(temp_min), 2)        as temp_min_media,
  round(avg(temp_media), 2)      as temp_media,
  round(avg(umidade_media), 1)   as umidade_media,
  count(*) filter (where temp_max > 30)   as dias_acima_30,
  count(*) filter (where temp_min >= 18)  as noites_quentes,
  round(sum(chuva_mm), 1)        as chuva_total
from clima.clima_diario
where horas_validas >= 20          -- so dias com leitura suficiente entram na media
group by 1;

comment on view clima.resumo_anual is
  'Estatisticas por ano. Anos parciais (2000 comeca em maio; o ano corrente) tem menos dias - conferir a coluna dias antes de comparar.';

grant select on clima.resumo_anual to anon, authenticated;
