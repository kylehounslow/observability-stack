FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY Main.java .
RUN javac Main.java

FROM eclipse-temurin:21-jre
COPY --from=build /src/*.class /app/
ENTRYPOINT ["java", "-cp", "/app", "Main"]
