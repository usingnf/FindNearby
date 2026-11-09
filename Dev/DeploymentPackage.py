import argparse
import json
import os
import re
import subprocess
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from dotenv import dotenv_values

from server.DeploymentData import SEED_ACCESS, SEED_SOURCES
from server.FacilityImport import PROJECT


class DeploymentPackage:
    server_files = (
        "CallBudget", "DeploymentData", "FacilityImport", "FacilityStore", "FindNearbyApi",
        "FindNearbyDeployment", "KakaoProvider", "Models", "RecommendationService",
    )

    def build(self, version: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,39}", version):
            raise ValueError("배포 버전에는 영문, 숫자, 점, 하이픈, 밑줄을 사용하세요.")
        root = PROJECT.parent
        output = root / "Build" / f"배포_FindNearby_{version}.zip"
        if output.exists():
            raise FileExistsError(output)
        subprocess.run(["node", "node_modules/typescript/bin/tsc", "--noEmit"], cwd=PROJECT, check=True)
        with TemporaryDirectory(dir=output.parent) as work:
            staging = Path(work)
            web = staging / "web"
            subprocess.run(
                ["node", "node_modules/vite/bin/vite.js", "build", "--outDir", str(web)],
                cwd=PROJECT, env={**os.environ, "VITE_KAKAO_JS_KEY": " "}, check=True,
            )
            inputs = {
                ".env.example": output.parent / "설정_FindNearby_시험배포.env.example",
                "안내_FindNearby_시험배포.md": output.parent / "안내_FindNearby_시험배포.md",
                "requirements.txt": PROJECT / "requirements.txt",
                "web/index.html": web / "index.html",
                **{f"server/{name}.py": PROJECT / "server" / f"{name}.py" for name in self.server_files},
                **{f"seed/{name}": root / "Resource" / name
                   for name in [*(row[0] for row in SEED_SOURCES), SEED_ACCESS]},
                **{f"web/assets/{path.name}": path for path in (web / "assets").iterdir()
                   if path.suffix in {".js", ".css", ".png", ".svg", ".woff2"}},
            }
            payload = {name: path.read_bytes() for name, path in inputs.items()}
            payload["seed/안내_FindNearby_초기데이터.md"] = (
                "# 초기 공공시설 데이터\n\n시설 91곳과 출입구의 이동수단별 접근점 10건을 적재하는 자료다. "
                "출처와 적재 절차는 상위 폴더의 시험 배포 안내에 있다.\n"
            ).encode("utf-8")
            self.check_keys(payload)
            manifest = {
                "version": version,
                "sha256": {name: sha256(data).hexdigest() for name, data in payload.items()},
            }
            archive = staging / output.name
            with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
                for name, data in payload.items():
                    bundle.writestr(name, data)
                bundle.writestr("목록_FindNearby_배포파일.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            if os.name == "nt":
                archive.rename(output)
            else:
                os.link(archive, output)
        return output

    @staticmethod
    def check_keys(payload: dict[str, bytes]) -> None:
        local = dotenv_values(PROJECT / ".env")
        for name in ("VITE_KAKAO_JS_KEY", "FIND_NEARBY_MAP_JS_KEY", "KAKAO_REST_API_KEY", "KAKAO_MOBILITY_REST_API_KEY"):
            for value in (os.getenv(name), local.get(name)):
                if value and len(value.strip()) >= 16 and any(value.strip().encode() in data for data in payload.values()):
                    raise ValueError(f"배포 파일에 {name} 값이 포함되어 있습니다.")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description="키 없는 시험 배포 ZIP 생성")
    cli.add_argument("version")
    print(DeploymentPackage().build(cli.parse_args().version))
