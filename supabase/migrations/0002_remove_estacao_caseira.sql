-- Fase 2 (ESP32) cancelada: o site e somente leitura de dados publicos.
drop table if exists clima.leituras_estacao;

-- 'estacao_caseira' deixa de ser uma origem possivel.
alter table clima.clima_diario drop constraint if exists clima_diario_fonte_check;
alter table clima.clima_diario add constraint clima_diario_fonte_check
  check (fonte in ('inmet_a001', 'open_meteo'));
