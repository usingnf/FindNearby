# PostgreSQL 데이터 이전

첫 SQL 파일이 시설·접근점·호출량 테이블과 함수 권한을 만들고, 두 번째 파일이 검증된 초기 공공자료를 적재합니다. 초기 SQL은 `Dev`에서 `python SupabaseSeed.py supabase/migrations/20261115000200_initial_data.sql`로 재현할 수 있습니다. 원본 CSV는 저장소의 `Resource`에 있습니다. 설치 후 자료를 갱신할 때는 별도의 이전 SQL을 추가합니다.
