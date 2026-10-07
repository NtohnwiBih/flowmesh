CREATE FUNCTION forbid_event_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'execution_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_events_no_update
    BEFORE UPDATE ON execution_events
    FOR EACH ROW EXECUTE FUNCTION forbid_event_update();