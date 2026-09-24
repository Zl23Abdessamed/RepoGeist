FROM mcr.microsoft.com/dotnet/sdk:10.0

WORKDIR /src

ENV PATH="$PATH:/root/.dotnet/tools"
ENV DOTNET_USE_POLLING_FILE_WATCHER=true
ENV DOTNET_WATCH_RESTART_ON_RUDE_EDIT=true

RUN dotnet tool install --global dotnet-ef --version 10.0.12

COPY *.csproj ./
RUN dotnet restore

COPY . .

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "dotnet ef database update && dotnet watch run --no-launch-profile --urls http://0.0.0.0:8080"]