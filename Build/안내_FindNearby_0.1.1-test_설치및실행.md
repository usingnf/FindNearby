# FindNearby 0.1.1-test 설치 및 실행

Windows PC에 `배포_FindNearby_0.1.1-test.zip`을 옮겨 압축을 풀면, `FindNearbyRun.cmd`로 설치와 실행을 시작할 수 있습니다. 카카오 API 키는 ZIP 안의 `.env`에 설정되어 있습니다.

## 처음 설치하기

1. 대상 PC에 **Python 3.15, 3.14, 3.12 중 하나**가 필요합니다. 지원하는 버전이 이미 설치되어 있으면 그대로 사용합니다. Windows용 Python 설치 관리자로 새로 설치하는 경우, PowerShell에서 `py install 3.15`를 실행합니다. [Windows용 Python 다운로드](https://www.python.org/downloads/windows/) · [Python 설치 안내](https://docs.python.org/3/using/windows.html#installing-runtimes)
2. ZIP의 모든 파일을 쓰기 가능한 폴더에 풉니다. 예를 들어 `C:\FindNearby\0.1.1-test`를 사용합니다.
3. 압축을 푼 폴더의 **`FindNearbyRun.cmd`**를 더블클릭합니다. 첫 실행에는 인터넷 연결이 필요합니다. 실행 파일이 필요한 Python 패키지를 설치하고 초기 시설 데이터를 불러옵니다.
4. 실행 창에 서버 시작 메시지가 나오면 브라우저에서 [FindNearby 열기](http://127.0.0.1:5173/)를 누릅니다. **실제 데이터** 모드에서 시설을 검색합니다. 카카오 지도와 경로 조회에도 인터넷 연결이 필요합니다.

## 다시 실행하거나 종료하기

다음부터는 같은 폴더의 `FindNearbyRun.cmd`를 실행하고 브라우저에서 같은 주소를 엽니다. 사용 중에는 실행 창을 열어 둡니다. 종료할 때는 실행 창에서 **Ctrl+C**를 누릅니다. 배치 작업을 종료할지 묻는 경우 `Y`를 입력합니다.

## 실행 문제 확인

- **Python을 찾을 수 없다는 메시지**가 나오면 새 PowerShell 창에서 `py -3.15 --version`, `py -3.14 --version`, `py -3.12 --version` 중 하나으로 설치를 확인한 뒤 실행 파일을 다시 엽니다. Python이 `python` 명령으로 등록되어 있다면 `python --version`으로 확인할 수 있습니다.
- **5173번 포트가 사용 중**이면 해당 포트를 사용 중인 프로그램을 종료한 뒤 다시 실행합니다.
- **검색은 되지만 카카오 지도가 표시되지 않으면** JavaScript 키의 허용 주소에 `http://127.0.0.1:5173`이 등록되어 있는지 확인합니다. [카카오 지도 JavaScript SDK 안내](https://apis.map.kakao.com/web/guide/)
- 실행 창에 오류가 표시되면 그 메시지를 확인한 뒤 창을 닫습니다.

## 배포 파일 보관

ZIP과 압축을 푼 폴더의 `.env`에는 실제 카카오 API 키가 들어 있습니다. 시험에 사용할 PC에만 비공개로 전달하고, 공개 저장소나 공개 다운로드 위치에는 올리지 않습니다.
